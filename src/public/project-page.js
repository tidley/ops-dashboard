(function() {
  var MESSAGE_PREVIEW_LIMIT = 2500;
  var POLL_INTERVAL_MS = 1500;
  var pollTimer = null;
  var pageInitialized = false;
  var outboundQueue = [];
  var activeRequest = null;

  function getBody() {
    return document.body;
  }

  function getProjectId() {
    return getBody().getAttribute('data-project-id') || '';
  }

  function getActiveTab() {
    return getBody().getAttribute('data-active-tab') || 'overview';
  }

  function isConversationTab() {
    var activeTab = getActiveTab();
    return activeTab === 'conversations' || activeTab === 'main-agent';
  }

  function getThread() {
    return document.querySelector('.chat-thread');
  }

  function scrollThreadToBottom() {
    var thread = getThread();
    if (!thread) return;
    var target = Math.max(0, Number(thread.scrollHeight || 0));
    if (typeof thread.scrollTo === 'function') {
      thread.scrollTo({ top: target, behavior: 'auto' });
    }
    thread.scrollTop = target;
  }

  function getComposer() {
    return document.getElementById('message_form');
  }

  function generateSessionId() {
    var time = Date.now().toString(36);
    var random = Math.random().toString(16).slice(2, 10);
    return 'ses-' + time + '-' + random;
  }

  function getSessionInput(form) {
    if (!form) return null;
    return form.querySelector('#session_id') || form.querySelector('[name="session_id"]');
  }

  function ensureSessionId(form) {
    var sessionInput = getSessionInput(form);
    if (!sessionInput) return '';
    var current = String(sessionInput.value || '').trim();
    if (current) return current;
    var generated = generateSessionId();
    sessionInput.value = generated;
    return generated;
  }

  function getSearchRoot(input) {
    return input.closest('[data-project-filter-root]');
  }

  function formatDateTime(iso) {
    if (!iso) return 'Unknown';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function formatRelativeTime(iso) {
    if (!iso) return 'No activity yet';
    var time = new Date(iso).getTime();
    if (Number.isNaN(time)) return 'Unknown';
    var diffMs = Date.now() - time;
    var absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
    if (absMinutes < 60) return absMinutes + 'm ago';
    var absHours = Math.round(absMinutes / 60);
    if (absHours < 24) return absHours + 'h ago';
    var absDays = Math.round(absHours / 24);
    return absDays + 'd ago';
  }

  function truncateMessageText(text) {
    var value = String(text || '');
    if (value.length <= MESSAGE_PREVIEW_LIMIT) {
      return {
        preview: value,
        full: value,
        truncated: false,
      };
    }

    return {
      preview: value.slice(0, MESSAGE_PREVIEW_LIMIT).replace(/\s+$/, '') + '...',
      full: value,
      truncated: true,
    };
  }

  function appendDetailsSection(parent, className, summaryText, childBuilder) {
    var details = document.createElement('details');
    details.className = className;

    var summary = document.createElement('summary');
    summary.className = 'chat-bubble__summary';
    summary.textContent = summaryText;
    details.appendChild(summary);

    if (typeof childBuilder === 'function') {
      childBuilder(details);
    }

    parent.appendChild(details);
    if (className.indexOf('chat-bubble__details--error') !== -1) {
      var syncSummary = function() {
        summary.textContent = details.open ? 'hide error' : 'show error';
      };
      syncSummary();
      if (typeof details.addEventListener === 'function') {
        details.addEventListener('toggle', syncSummary);
      }
    }
    return details;
  }

  function createMessageNode(message) {
    var isOutbound = message.direction === 'outbound';
    var article = document.createElement('article');
    article.className = 'chat-row ' + (isOutbound ? 'chat-row--outbound' : 'chat-row--inbound');
    if (message.status === 'queued' || message.status === 'sending') {
      article.className += ' chat-row--pending';
    }
    if (message.id) article.setAttribute('data-message-id', message.id);

    var content = document.createElement('div');
    content.className = 'chat-row__content';

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    var messageText = truncateMessageText(message.content || '(empty)');
    var body = document.createElement('pre');
    body.className = 'chat-bubble__body' + (messageText.truncated ? ' chat-bubble__body--preview' : '');
    body.textContent = messageText.preview;
    bubble.appendChild(body);

    if (messageText.truncated) {
      appendDetailsSection(bubble, 'chat-bubble__details chat-bubble__details--message', 'show more', function(details) {
        var full = document.createElement('pre');
        full.className = 'chat-bubble__body chat-bubble__body--full';
        full.textContent = messageText.full;
        details.appendChild(full);
      });
    }

    if (message.error_text) {
      appendDetailsSection(bubble, 'chat-bubble__details chat-bubble__details--error', 'show error', function(details) {
        var err = document.createElement('div');
        err.className = 'chat-bubble__error';
        err.textContent = message.error_text;
        details.appendChild(err);
      });
    }

    var stamp = document.createElement('div');
    stamp.className = 'chat-row__stamp';
    var createdAt = message.created_at || new Date().toISOString();
    stamp.title = formatDateTime(createdAt);
    stamp.textContent = formatDateTime(createdAt) + ' · ' + formatRelativeTime(createdAt);

    content.appendChild(bubble);
    content.appendChild(stamp);

    article.appendChild(content);
    return article;
  }

  function appendOptimisticMessage(message) {
    var thread = getThread();
    if (!thread) return null;
    var node = createMessageNode(message);
    thread.appendChild(node);
    scrollThreadToBottom();
    return node;
  }

  function renderQueuedMessages() {
    if (!outboundQueue.length) return;
    outboundQueue.forEach(function(item) {
      if (item.optimisticNode && item.optimisticNode.parentNode) return;
      item.optimisticNode = appendOptimisticMessage(item.message);
    });
  }

  function replaceMessageNode(node, message) {
    if (!node || !node.parentNode) return null;
    var replacement = createMessageNode(message);
    node.parentNode.replaceChild(replacement, node);
    return replacement;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getExistingMessageIds(thread) {
    var ids = {};
    if (!thread) return ids;
    thread.querySelectorAll('[data-message-id]').forEach(function(node) {
      var id = node.getAttribute('data-message-id');
      if (id) ids[id] = true;
    });
    return ids;
  }

  function appendMessages(messages) {
    var thread = getThread();
    if (!thread || !Array.isArray(messages) || !messages.length) return;

    var existingIds = getExistingMessageIds(thread);
    var fragment = document.createDocumentFragment();
    var appended = 0;

    messages.forEach(function(msg) {
      if (msg.id && existingIds[msg.id]) return;
      fragment.appendChild(createMessageNode(msg));
      appended += 1;
      if (msg.id) existingIds[msg.id] = true;
    });

    if (appended > 0) {
      thread.appendChild(fragment);
      scrollThreadToBottom();
    }
  }

  function renderThread(messages) {
    var thread = getThread();
    if (!thread || !Array.isArray(messages)) return;
    thread.innerHTML = '';
    messages.forEach(function(msg) {
      thread.appendChild(createMessageNode(msg));
    });
    scrollThreadToBottom();
  }

  function setLoading(submitButton) {
    if (!submitButton) return;
    submitButton.disabled = true;
    submitButton.textContent = 'Sending…';
  }

  function clearLoading(submitButton) {
    if (!submitButton) return;
    submitButton.disabled = false;
    var messageType = submitButton.getAttribute('data-label') || 'Send';
    submitButton.textContent = messageType;
  }

  function bindSubmitterLabels(form) {
    form.querySelectorAll('button[type="submit"]').forEach(function(button) {
      if (!button.getAttribute('data-label')) {
        button.setAttribute('data-label', button.textContent.trim());
      }
    });
  }

  function submitMessage(form, submitButton) {
    var projectId = getProjectId();
    if (!projectId) return;

    var textarea = form.querySelector('#text');
    var text = textarea ? textarea.value : '';
    var sessionId = ensureSessionId(form);
    var messageType = (submitButton && submitButton.value) || (form.querySelector('[name="message_type"]') || {}).value || 'prompt';
    var priority = (form.querySelector('[name="priority"]') || {}).value || 'normal';
    var optimisticId = 'pending-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    var queuedMessage = {
      id: optimisticId,
      direction: 'outbound',
      message_type: messageType,
      priority: priority,
      content: text || '(empty)',
      status: 'queued',
      created_at: new Date().toISOString(),
    };

    var params = new URLSearchParams(new FormData(form));
    params.set('session_id', sessionId);
    params.set('text', text);
    if (submitButton && submitButton.name) {
      params.set(submitButton.name, submitButton.value);
    }

    var queueItem = {
      optimisticId: optimisticId,
      message: queuedMessage,
      body: params.toString(),
      messageType: messageType,
      priority: priority,
      text: text,
      optimisticNode: appendOptimisticMessage(queuedMessage),
      submittedAt: new Date().toISOString(),
    };
    if (textarea) textarea.value = '';
    outboundQueue.push(queueItem);
    flushOutboundQueue();
  }

  function flushOutboundQueue() {
    if (activeRequest || !outboundQueue.length) return;

    var projectId = getProjectId();
    if (!projectId) return;

    var item = outboundQueue[0];
    activeRequest = item;
    item.message.status = 'sending';
    if (item.optimisticNode) {
      item.optimisticNode = replaceMessageNode(item.optimisticNode, item.message);
    }

    fetch('/api/project/' + projectId + '/message', {
      method: 'POST',
      body: item.body,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      }
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        outboundQueue.shift();
        activeRequest = null;
        if (data.success && data.messages) {
          try {
            var composer = getComposer();
            var sessionInput = getSessionInput(composer);
            if (sessionInput && data.session_id) {
              sessionInput.value = data.session_id;
            }
            if (data.session_id) {
              var nextUrl = new URL(window.location.href);
              nextUrl.searchParams.set('session', data.session_id);
              window.history.replaceState({}, '', nextUrl.toString());
            }
          } catch (sessionErr) {
            console.error('session sync error', sessionErr);
          }

          try {
            renderThread(data.messages);
          } catch (renderErr) {
            console.error('thread render error', renderErr);
          }

          try {
            renderQueuedMessages();
          } catch (queueErr) {
            console.error('queue render error', queueErr);
          }
        } else if (data.error) {
          alert('Error: ' + data.error);
          if (item.optimisticNode) {
            replaceMessageNode(item.optimisticNode, {
              id: item.optimisticId,
              direction: 'outbound',
              message_type: item.messageType,
              priority: item.priority,
              content: item.text || '(empty)',
              status: 'error',
              error_text: data.error,
              created_at: new Date().toISOString(),
            });
          }
        }
        flushOutboundQueue();
      })
      .catch(function(err) {
        outboundQueue.shift();
        activeRequest = null;
        alert('Network error');
        if (item.optimisticNode) {
          replaceMessageNode(item.optimisticNode, {
            id: item.optimisticId,
            direction: 'outbound',
            message_type: item.messageType,
            priority: item.priority,
            content: item.text || '(empty)',
            status: 'error',
            error_text: 'Network error',
            created_at: new Date().toISOString(),
          });
        }
        console.error(err);
        flushOutboundQueue();
      });
  }

  function bindPolling() {
    if (pollTimer) return;

    var poll = function() {
      var activeTab = getActiveTab();
      var thread = getThread();
      var form = getComposer();

      if (!isConversationTab() || !thread || !form) {
        pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      if (activeRequest || outboundQueue.length) {
        pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      var sessionInput = getSessionInput(form);
      var sessionId = sessionInput ? String(sessionInput.value || '').trim() : '';
      var agentInput = form.querySelector('#agent_id') || form.querySelector('[name="agent_id"]');
      var agentId = agentInput ? String(agentInput.value || '').trim() : '';
      if (!sessionId) {
        pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      var messagesUrl = '/api/project/' + getProjectId() + '/messages?session_id=' + encodeURIComponent(sessionId);
      if (agentId) {
        messagesUrl += '&agent_id=' + encodeURIComponent(agentId);
      }

      fetch(messagesUrl)
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.session_id && Array.isArray(data.messages)) {
            appendMessages(data.messages);
          }
          pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
        })
        .catch(function(err) {
          console.error('poll error', err);
          pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS * 2);
        });
    };

    pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
  }

  function updateProjectFilter(input) {
    var root = getSearchRoot(input);
    if (!root) return;

    var query = input.value.trim().toLowerCase();
    var items = Array.prototype.slice.call(root.querySelectorAll('[data-project-item]'));
    var sections = Array.prototype.slice.call(root.querySelectorAll('[data-project-section]'));
    var empty = root.querySelector('[data-project-empty]');
    var visibleCount = 0;

    items.forEach(function(item) {
      var search = (item.getAttribute('data-project-search') || '').toLowerCase();
      var visible = !query || search.indexOf(query) !== -1;
      item.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    sections.forEach(function(section) {
      var sectionVisible = section.querySelector('[data-project-item]:not([hidden])');
      section.hidden = !sectionVisible;
    });

    if (empty) {
      empty.hidden = visibleCount !== 0;
    }
  }

  function syncFilterState() {
    var input = document.querySelector('[data-project-filter-input]');
    if (input) updateProjectFilter(input);
  }

  function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', Boolean(open));
    var button = document.querySelector('[data-sidebar-toggle]');
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function openSidebar() {
    setSidebarOpen(true);
  }

  function swapPage(nextDoc, url, pushHistory) {
    var nextShell = nextDoc.querySelector('.shell');
    var currentShell = document.querySelector('.shell');
    if (!nextShell || !currentShell) return false;

    if (pushHistory !== false) {
      window.history.pushState({}, '', url);
    } else {
      window.history.replaceState({}, '', url);
    }

    document.title = nextDoc.title || document.title;

    var nextBody = nextDoc.body;
    if (nextBody) {
      getBody().setAttribute('data-project-id', nextBody.getAttribute('data-project-id') || '');
      getBody().setAttribute('data-active-tab', nextBody.getAttribute('data-active-tab') || '');
    }

    currentShell.replaceWith(nextShell.cloneNode(true));
    closeSidebar();
    syncFilterState();
    bindMessageComposer();
    bindPolling();
    if (isConversationTab()) {
      scrollThreadToBottom();
    }
    return true;
  }

  function navigate(url, pushHistory) {
    return fetch(url, {
      headers: { Accept: 'text/html' }
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(html) {
        var parser = new DOMParser();
        var nextDoc = parser.parseFromString(html, 'text/html');
        if (!swapPage(nextDoc, url, pushHistory)) {
          window.location.href = url;
        }
      })
      .catch(function(err) {
        console.error('navigation error', err);
        window.location.href = url;
      });
  }

  function bindMessageComposer() {
    var form = getComposer();
    if (!form || form.getAttribute('data-bound') === 'true') return;
    form.setAttribute('data-bound', 'true');
    bindSubmitterLabels(form);

    var textarea = form.querySelector('#text');
    if (textarea) {
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          var promptButton = form.querySelector('button[value="prompt"]');
          if (promptButton) promptButton.click();
        }
      });
    }
  }

  function handleDocumentClick(e) {
    var sidebarToggle = e.target.closest('[data-sidebar-toggle]');
    if (sidebarToggle) {
      e.preventDefault();
      if (document.body.classList.contains('sidebar-open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
      return;
    }

    var backdrop = e.target.closest('[data-sidebar-backdrop]');
    if (backdrop) {
      closeSidebar();
      return;
    }

    var navLink = e.target.closest('.tabs a, .project-item__link');
    if (!navLink) return;

    var href = navLink.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;

    var nextUrl = new URL(href, window.location.origin);
    if (nextUrl.origin !== window.location.origin) return;

    if (!nextUrl.pathname.startsWith('/project/')) return;

    e.preventDefault();
    navigate(nextUrl.toString(), true);
  }

  function handleDocumentSubmit(e) {
    var form = e.target;
    if (!form || form.id !== 'message_form') return;
    e.preventDefault();

    var submitButton = e.submitter || form.querySelector('button[type="submit"]');
    submitMessage(form, submitButton);
  }

  function handleDocumentInput(e) {
    var input = e.target;
    if (!input || !input.matches('[data-project-filter-input]')) return;
    updateProjectFilter(input);
  }

  function handlePopState() {
    navigate(window.location.href, false);
  }

  function init() {
    if (pageInitialized) return;
    pageInitialized = true;

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('submit', handleDocumentSubmit);
    document.addEventListener('input', handleDocumentInput);
    window.addEventListener('popstate', handlePopState);

    bindMessageComposer();
    syncFilterState();
    bindPolling();
    if (isConversationTab()) {
      scrollThreadToBottom();
    }
  }

  init();

  window.OpsDashboardProjectPage = {
    createMessageNode: createMessageNode,
    truncateMessageText: truncateMessageText,
    scrollThreadToBottom: scrollThreadToBottom,
    submitMessage: submitMessage,
    flushOutboundQueue: flushOutboundQueue,
    renderQueuedMessages: renderQueuedMessages,
  };
})();
