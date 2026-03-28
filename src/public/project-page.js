(function() {
  var MESSAGE_PREVIEW_LIMIT = 2500;
  var POLL_INTERVAL_MS = 1500;
  var pollTimer = null;
  var pageInitialized = false;
  var outboundQueue = [];
  var activeRequest = null;
  var PAGE_CACHE_TTL_MS = 5 * 60 * 1000;
  var MESSAGE_CACHE_TTL_MS = 8000;
  var TAB_PREFETCH_DELAY_MS = 400;
  var pageHtmlCache = new Map();
  var pageHtmlRequests = new Map();
  var messagesCache = new Map();
  var projectTabPrefetchTimer = null;

  function getBody() {
    return document.body;
  }

  function getProjectContext() {
    return window.PROJECT_CONTEXT || {};
  }

  function getProjectId() {
    return getProjectContext().projectId || getBody().getAttribute('data-project-id') || '';
  }

  function cacheKeyForUrl(url) {
    try {
      return new URL(url, window.location.origin).toString();
    } catch {
      return String(url || '');
    }
  }

  function hasProjectId() {
    return Boolean(getProjectId());
  }

  function getActiveTab() {
    return getProjectContext().activeTab || getBody().getAttribute('data-active-tab') || 'overview';
  }

  function isConversationTab() {
    var activeTab = getActiveTab();
    return activeTab === 'conversations' || activeTab === 'main-agent';
  }

  function getThread() {
    return document.querySelector('.chat-thread');
  }

  function getRecentFilesRoot() {
    return document.querySelector('[data-recent-files-root]');
  }

  function getCurrentSessionId() {
    var context = getProjectContext();
    if (context && context.sessionId) return String(context.sessionId).trim();

    var composer = getComposer();
    var sessionInput = getSessionInput(composer);
    if (sessionInput && sessionInput.value) return String(sessionInput.value).trim();

    var bodySessionId = getBody().getAttribute('data-session-id');
    if (bodySessionId) return String(bodySessionId).trim();

    return '';
  }

  function getMessagesCacheKey(projectId, sessionId, agentId) {
    return [projectId || '', sessionId || '', agentId || ''].join('|');
  }

  function getCachedPageHtml(url) {
    var key = cacheKeyForUrl(url);
    var entry = key ? pageHtmlCache.get(key) : null;
    if (!entry) return '';
    if (Date.now() - entry.fetchedAt > PAGE_CACHE_TTL_MS) {
      pageHtmlCache.delete(key);
      return '';
    }
    return entry.html || '';
  }

  function setCachedPageHtml(url, html) {
    var key = cacheKeyForUrl(url);
    if (!key || typeof html !== 'string') return;
    pageHtmlCache.set(key, {
      html: html,
      fetchedAt: Date.now(),
    });
  }

  function getCachedMessages(projectId, sessionId, agentId) {
    var key = getMessagesCacheKey(projectId, sessionId, agentId);
    var entry = key ? messagesCache.get(key) : null;
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > MESSAGE_CACHE_TTL_MS) {
      messagesCache.delete(key);
      return null;
    }
    return entry.messages || null;
  }

  function setCachedMessages(projectId, sessionId, agentId, messages) {
    var key = getMessagesCacheKey(projectId, sessionId, agentId);
    if (!key || !Array.isArray(messages)) return;
    messagesCache.set(key, {
      messages: messages,
      fetchedAt: Date.now(),
    });
  }

  function getRecentFileItems() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-recent-file-item]'));
  }

  function clearRecentFileSelection() {
    getRecentFileItems().forEach(function(button) {
      button.classList.remove('is-selected');
      button.setAttribute('aria-expanded', 'false');
      var trigger = button.querySelector('[data-recent-file-trigger]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      var detail = button.querySelector('[data-recent-file-detail]');
      if (detail) {
        detail.classList.remove('is-open');
        detail.style.maxHeight = '0px';
        detail.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function getRecentFileItemDetail(item) {
    if (!item) return null;
    return item.querySelector('[data-recent-file-detail]');
  }

  function setRecentFileDetailOpen(item, open) {
    var detail = getRecentFileItemDetail(item);
    if (!detail) return;
    var trigger = item.querySelector('[data-recent-file-trigger]');
    item.classList.toggle('is-selected', Boolean(open));
    item.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    detail.classList.toggle('is-open', Boolean(open));
    detail.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      detail.style.maxHeight = detail.scrollHeight + 'px';
    } else {
      detail.style.maxHeight = '0px';
    }
  }

  function closeRecentFileDetail() {
    clearRecentFileSelection();
  }

  function openRecentFileDetail(button) {
    if (!button) return;

    var item = typeof button.closest === 'function'
      ? button.closest('[data-recent-file-item]')
      : button;
    if (!item) return;

    var selected = item.classList.contains('is-selected') && getRecentFileItemDetail(item) && getRecentFileItemDetail(item).classList.contains('is-open');
    if (selected) {
      closeRecentFileDetail();
      return;
    }

    clearRecentFileSelection();
    setRecentFileDetailOpen(item, true);
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

  function stopPolling() {
    if (!pollTimer) return;
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function fetchAndCachePageHtml(url) {
    var key = cacheKeyForUrl(url);
    if (!key) {
      return Promise.reject(new Error('invalid_url'));
    }

    var inflight = pageHtmlRequests.get(key);
    if (inflight) return inflight;

    var request = fetch(url, {
      headers: { Accept: 'text/html' }
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(html) {
        setCachedPageHtml(url, html);
        return html;
      })
      .finally(function() {
        pageHtmlRequests.delete(key);
      });

    pageHtmlRequests.set(key, request);
    return request;
  }

  function buildProjectTabUrl(tab, sessionId) {
    var projectId = getProjectId();
    if (!projectId || !tab) return '';

    var url = new URL('/project/' + encodeURIComponent(projectId), window.location.origin);
    url.searchParams.set('tab', tab);
    if (sessionId) {
      url.searchParams.set('session', sessionId);
    }
    return url.toString();
  }

  function getProjectTabPrefetchUrls() {
    var activeTab = getActiveTab();
    var sessionId = getCurrentSessionId();
    return ['overview', 'conversations', 'main-agent', 'workflows', 'memory', 'files', 'logs', 'settings']
      .filter(function(tab) { return tab !== activeTab; })
      .map(function(tab) { return buildProjectTabUrl(tab, sessionId); })
      .filter(Boolean);
  }

  function prefetchProjectTabUrl(url) {
    if (!url || getCachedPageHtml(url)) return Promise.resolve(false);
    return fetchAndCachePageHtml(url)
      .then(function() {
        return true;
      })
      .catch(function() {
        return false;
      });
  }

  function prefetchProjectTabs() {
    if (!hasProjectId()) return;
    if (projectTabPrefetchTimer) return;

    var run = function() {
      projectTabPrefetchTimer = null;
      var urls = getProjectTabPrefetchUrls();
      if (!urls.length) return;

      var chain = Promise.resolve();
      urls.forEach(function(url) {
        chain = chain.then(function() {
          return prefetchProjectTabUrl(url);
        });
      });
    };

    if (window.requestIdleCallback) {
      projectTabPrefetchTimer = window.requestIdleCallback(run, { timeout: TAB_PREFETCH_DELAY_MS });
      return;
    }

    projectTabPrefetchTimer = window.setTimeout(run, TAB_PREFETCH_DELAY_MS);
  }

  function prefetchProjectTabOnIntent(url) {
    if (!url || !hasProjectId()) return;
    if (getCachedPageHtml(url)) return;
    prefetchProjectTabUrl(url);
  }

  function rehydratePageModules() {
    if (window.OpsDashboardSidebarSections && typeof window.OpsDashboardSidebarSections.init === 'function') {
      window.OpsDashboardSidebarSections.init();
    }

    if (window.OpsDashboardHomeUsage && typeof window.OpsDashboardHomeUsage.initUsageCharts === 'function') {
      window.OpsDashboardHomeUsage.initUsageCharts();
    }

    if (window.OpsDashboardOpenClawControl && typeof window.OpsDashboardOpenClawControl.refresh === 'function') {
      window.OpsDashboardOpenClawControl.refresh();
    }
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

  function getSettingsWizard() {
    return window.PROJECT_SETTINGS_WIZARD || {};
  }

  function getSettingsField(id) {
    return document.getElementById(id);
  }

  function setSettingsFieldValue(id, value) {
    var field = getSettingsField(id);
    if (!field) return;
    field.value = String(value || '');
    if (typeof field.focus === 'function') {
      field.focus({ preventScroll: true });
    }
    if (typeof field.scrollIntoView === 'function') {
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function wireProjectSettingsWizard() {
    var wizard = getSettingsWizard();
    var codeFolderBtn = document.getElementById('wizard_use_code_folder_btn');
    var instructionsBtn = document.getElementById('wizard_fill_instructions_btn');

    if (codeFolderBtn) {
      codeFolderBtn.addEventListener('click', function() {
        setSettingsFieldValue('code_folder', wizard.codeFolder || '');
      });
    }

    if (instructionsBtn) {
      instructionsBtn.addEventListener('click', function() {
        setSettingsFieldValue('getting_started', wizard.starterInstructions || '');
      });
    }
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
    var isMessageDetails = className.indexOf('chat-bubble__details--message') !== -1;

    var summary = document.createElement('summary');
    summary.className = 'chat-bubble__summary';
    summary.textContent = summaryText;

    if (typeof childBuilder === 'function') {
      childBuilder(details);
    }

    details.appendChild(summary);

    parent.appendChild(details);
    if (isMessageDetails || className.indexOf('chat-bubble__details--error') !== -1) {
      var syncSummary = function() {
        if (isMessageDetails) {
          summary.textContent = details.open ? 'show less' : 'show more';
          return;
        }
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
            var bodyParams = new URLSearchParams(item.body || '');
            var agentId = bodyParams.get('agent_id') || '';
            var resolvedSessionId = data.session_id || (sessionInput && sessionInput.value) || '';
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
            setCachedMessages(projectId, resolvedSessionId, agentId, data.messages);
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
    if (!hasProjectId()) {
      stopPolling();
      return;
    }
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

      var cachedMessages = getCachedMessages(getProjectId(), sessionId, agentId);
      if (cachedMessages) {
        appendMessages(cachedMessages);
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
            setCachedMessages(getProjectId(), data.session_id, agentId, data.messages);
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

  function getDesktopSidebarCollapsedKey() {
    return 'ops-dashboard.project-sidebar-collapsed:' + getProjectId();
  }

  function readDesktopSidebarCollapsed() {
    try {
      return window.localStorage.getItem(getDesktopSidebarCollapsedKey()) === '1';
    } catch {
      return false;
    }
  }

  function writeDesktopSidebarCollapsed(collapsed) {
    try {
      window.localStorage.setItem(getDesktopSidebarCollapsedKey(), collapsed ? '1' : '0');
    } catch {}
  }

  function setDesktopSidebarCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', Boolean(collapsed));
    var button = document.querySelector('[data-sidebar-desktop-toggle]');
    if (button) {
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.setAttribute('aria-label', collapsed ? 'Expand projects sidebar' : 'Collapse projects sidebar');
      button.setAttribute('title', collapsed ? 'Expand projects sidebar' : 'Collapse projects sidebar');
    }
    writeDesktopSidebarCollapsed(collapsed);
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

    stopPolling();
    currentShell.replaceWith(nextShell.cloneNode(true));
    closeSidebar();
    syncFilterState();
    rehydratePageModules();
    bindMessageComposer();
    if (hasProjectId()) {
      bindPolling();
    }
    if (isConversationTab()) {
      scrollThreadToBottom();
    }
    return true;
  }

  function navigate(url, pushHistory) {
    var cachedHtml = getCachedPageHtml(url);
    if (cachedHtml) {
      try {
        var cachedDoc = new DOMParser().parseFromString(cachedHtml, 'text/html');
        if (swapPage(cachedDoc, url, pushHistory)) {
          return Promise.resolve(true);
        }
      } catch (err) {
        console.error('cached navigation error', err);
      }
    }

    return fetchAndCachePageHtml(url)
      .then(function(html) {
        var nextDoc = new DOMParser().parseFromString(html, 'text/html');
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
    var tabLink = e.target.closest('.tabs a');
    if (tabLink) {
      prefetchProjectTabOnIntent(tabLink.href || tabLink.getAttribute('href') || '');
    }

    var recentFileTrigger = e.target.closest('[data-recent-file-trigger]');
    if (recentFileTrigger) {
      e.preventDefault();
      openRecentFileDetail(recentFileTrigger);
      return;
    }

    var recentFilesRoot = getRecentFilesRoot();
    if (recentFilesRoot && !e.target.closest('[data-recent-files-root]')) {
      closeRecentFileDetail();
    }

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

    var desktopSidebarToggle = e.target.closest('[data-sidebar-desktop-toggle]');
    if (desktopSidebarToggle) {
      e.preventDefault();
      var nextCollapsed = !document.body.classList.contains('sidebar-collapsed');
      setDesktopSidebarCollapsed(nextCollapsed);
      return;
    }

    var navLink = e.target.closest('.tabs a, .project-item__link, .brand a, .topbar__meta a[href="/settings"], .topbar__meta a[href="/"]');
    if (!navLink) return;

    var href = navLink.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;

    var nextUrl = new URL(href, window.location.origin);
    if (nextUrl.origin !== window.location.origin) return;

    if (nextUrl.pathname !== '/' && nextUrl.pathname !== '/settings' && !nextUrl.pathname.startsWith('/project/')) return;

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

  function handleDocumentIntent(e) {
    var tabLink = e.target.closest('.tabs a');
    if (!tabLink) return;
    prefetchProjectTabOnIntent(tabLink.href || tabLink.getAttribute('href') || '');
  }

  function handlePopState() {
    navigate(window.location.href, false);
  }

  function init() {
    if (pageInitialized) return;
    pageInitialized = true;

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('mouseover', handleDocumentIntent);
    document.addEventListener('focusin', handleDocumentIntent);
    document.addEventListener('submit', handleDocumentSubmit);
    document.addEventListener('input', handleDocumentInput);
    window.addEventListener('popstate', handlePopState);

    if (window.matchMedia && window.matchMedia('(min-width: 861px)').matches) {
      setDesktopSidebarCollapsed(readDesktopSidebarCollapsed());
    }

    bindMessageComposer();
    wireProjectSettingsWizard();
    syncFilterState();
    prefetchProjectTabs();
    if (hasProjectId()) {
      bindPolling();
    } else {
      stopPolling();
    }
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
    openRecentFileDetail: openRecentFileDetail,
    closeRecentFileDetail: closeRecentFileDetail,
    setDesktopSidebarCollapsed: setDesktopSidebarCollapsed,
  };
})();
