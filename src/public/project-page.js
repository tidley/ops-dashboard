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
  var RECENT_FILES_POLL_INTERVAL_MS = 15000;
  var pageHtmlCache = new Map();
  var pageHtmlRequests = new Map();
  var messagesCache = new Map();
  var projectTabPrefetchTimer = null;
  var recentFilesPollTimer = null;
  var recentFilesRequest = null;
  var recentFilesRequestToken = 0;
  var recentFilesLastSignature = '';
  var projectRailResizePointerId = null;
  var projectRailResizeStartX = 0;
  var projectRailResizeStartWidth = 0;

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

  function getRecentFilesControlsScope() {
    var root = getRecentFilesRoot();
    if (!root) return null;
    return (typeof root.closest === 'function' && root.closest('.project-rail__section'))
      || getProjectRailRoot()
      || document;
  }

  function getProjectRailRoot() {
    return document.querySelector('[data-project-rail]');
  }

  function getProjectRailResizeHandle() {
    var root = getProjectRailRoot();
    return root ? root.querySelector('[data-project-rail-resize-handle]') : null;
  }

  function getRecentFilesList() {
    var root = getRecentFilesRoot();
    return root ? root.querySelector('[data-recent-files-list]') : null;
  }

  function getRecentFilesEmptyState() {
    var root = getRecentFilesRoot();
    return root ? root.querySelector('[data-recent-files-empty]') : null;
  }

  function getRecentFilesCountEl() {
    var scope = getRecentFilesControlsScope();
    return scope ? scope.querySelector('[data-recent-files-count]') : null;
  }

  function getRecentFilesSortButtons() {
    var scope = getRecentFilesControlsScope();
    return scope ? Array.prototype.slice.call(scope.querySelectorAll('[data-recent-files-sort-option]')) : [];
  }

  function getRecentFilesStorageKey() {
    return 'ops-dashboard.project-recent-files-sort:' + getProjectId();
  }

  function getProjectRailWidthStorageKey() {
    return 'ops-dashboard.project-rail-width:' + getProjectId();
  }

  function getRecentFilesSortDefaults(key) {
    return key === 'recent' ? 'desc' : 'asc';
  }

  function isDesktopProjectLayout() {
    return Boolean(window.matchMedia && window.matchMedia('(min-width: 861px)').matches);
  }

  function getProjectRailWidthBounds() {
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    var maxWidth = Math.min(720, Math.max(360, Math.round(viewportWidth * 0.58)));
    var minWidth = Math.min(320, maxWidth);
    return {
      min: minWidth,
      max: maxWidth,
    };
  }

  function normalizeProjectRailWidth(value) {
    var bounds = getProjectRailWidthBounds();
    var width = Number(value);
    if (!Number.isFinite(width) || width <= 0) {
      width = bounds.max;
    }
    return Math.max(bounds.min, Math.min(bounds.max, Math.round(width)));
  }

  function readProjectRailWidth() {
    try {
      var stored = window.localStorage.getItem(getProjectRailWidthStorageKey());
      if (!stored) return null;
      var width = Number(stored);
      return Number.isFinite(width) && width > 0 ? normalizeProjectRailWidth(width) : null;
    } catch {
      return null;
    }
  }

  function writeProjectRailWidth(width) {
    try {
      window.localStorage.setItem(getProjectRailWidthStorageKey(), String(normalizeProjectRailWidth(width)));
    } catch {}
  }

  function clearProjectRailWidth() {
    getBody().style.removeProperty('--project-rail-width');
  }

  function applyProjectRailWidth(width) {
    if (!isDesktopProjectLayout()) {
      clearProjectRailWidth();
      return null;
    }
    var normalized = normalizeProjectRailWidth(width);
    getBody().style.setProperty('--project-rail-width', normalized + 'px');
    return normalized;
  }

  function syncProjectRailWidth() {
    if (!isDesktopProjectLayout()) {
      clearProjectRailWidth();
      return null;
    }
    var stored = readProjectRailWidth();
    if (stored) {
      return applyProjectRailWidth(stored);
    }
    clearProjectRailWidth();
    return null;
  }

  function setProjectRailWidth(width, persist) {
    var normalized = applyProjectRailWidth(width);
    if (normalized === null) return null;
    if (persist !== false) writeProjectRailWidth(normalized);
    return normalized;
  }

  function startProjectRailResize(event) {
    if (!isDesktopProjectLayout()) return;
    if (!hasProjectId()) return;
    var handle = event && event.target ? event.target.closest('[data-project-rail-resize-handle]') : null;
    if (!handle) return;
    if (event.button !== 0) return;

    var root = getProjectRailRoot();
    if (!root) return;

    event.preventDefault();

    if (getBody().classList.contains('project-rail-collapsed')) {
      setDesktopSidebarCollapsed(false);
    }

    var current = readProjectRailWidth();
    if (!current) {
      current = normalizeProjectRailWidth(root.getBoundingClientRect().width || 0);
    }

    projectRailResizePointerId = event.pointerId;
    projectRailResizeStartX = event.clientX;
    projectRailResizeStartWidth = current;
    getBody().classList.add('is-resizing-project-rail');

    window.addEventListener('pointermove', handleProjectRailResizeMove, true);
    window.addEventListener('pointerup', handleProjectRailResizeEnd, true);
    window.addEventListener('pointercancel', handleProjectRailResizeEnd, true);
  }

  function handleProjectRailResizeMove(event) {
    if (projectRailResizePointerId === null || event.pointerId !== projectRailResizePointerId) return;
    var nextWidth = projectRailResizeStartWidth + (projectRailResizeStartX - event.clientX);
    setProjectRailWidth(nextWidth, false);
  }

  function handleProjectRailResizeEnd(event) {
    if (projectRailResizePointerId === null || event.pointerId !== projectRailResizePointerId) return;
    window.removeEventListener('pointermove', handleProjectRailResizeMove, true);
    window.removeEventListener('pointerup', handleProjectRailResizeEnd, true);
    window.removeEventListener('pointercancel', handleProjectRailResizeEnd, true);
    getBody().classList.remove('is-resizing-project-rail');
    if (getBody().classList.contains('project-rail-collapsed')) {
      projectRailResizePointerId = null;
      return;
    }
    var currentWidth = getBody().style.getPropertyValue('--project-rail-width');
    if (currentWidth) {
      writeProjectRailWidth(Number(currentWidth.replace(/px$/, '')));
    }
    projectRailResizePointerId = null;
  }

  function normalizeRecentFilesSortState(value) {
    var state = {
      key: 'recent',
      direction: 'desc',
    };

    if (value && typeof value === 'object') {
      state.key = String(value.key || value.sort || state.key).trim().toLowerCase();
      state.direction = String(value.direction || value.dir || state.direction).trim().toLowerCase();
    } else {
      var raw = String(value || 'recent:desc').trim().toLowerCase().replace(/\s+/g, '');
      var parts = raw.split(':');
      state.key = parts[0] || state.key;
      state.direction = parts[1] || state.direction;
    }

    if (state.key !== 'recent' && state.key !== 'name' && state.key !== 'path') {
      state.key = 'recent';
    }
    if (state.direction !== 'asc' && state.direction !== 'desc') {
      state.direction = getRecentFilesSortDefaults(state.key);
    }
    return state;
  }

  function formatRecentFilesSortState(value) {
    var state = normalizeRecentFilesSortState(value);
    return state.key + ':' + state.direction;
  }

  function readRecentFilesSort() {
    var root = getRecentFilesRoot();
    var sort = root ? root.getAttribute('data-recent-files-sort') : '';
    try {
      var stored = window.localStorage.getItem(getRecentFilesStorageKey());
      if (stored) sort = stored;
    } catch {}
    return formatRecentFilesSortState(sort);
  }

  function writeRecentFilesSort(sort) {
    try {
      window.localStorage.setItem(getRecentFilesStorageKey(), formatRecentFilesSortState(sort));
    } catch {}
  }

  function getRecentFilesSortArrow(sortKey, direction) {
    if (sortKey === 'name' || sortKey === 'path') {
      return direction === 'asc' ? '↓' : '↑';
    }
    return direction === 'asc' ? '↑' : '↓';
  }

  function updateRecentFilesSortButtons(sort) {
    var activeSort = normalizeRecentFilesSortState(sort);
    getRecentFilesSortButtons().forEach(function(button) {
      var buttonSort = String(button.getAttribute('data-recent-files-sort-option') || '').trim().toLowerCase();
      var isActive = buttonSort === activeSort.key;
      var arrow = button.querySelector('[data-recent-files-sort-arrow]');
      var label = button.querySelector('.project-rail__sort-label');
      var baseLabel = buttonSort === 'path' ? 'Relative' : (buttonSort.charAt(0).toUpperCase() + buttonSort.slice(1));
      var directionArrow = getRecentFilesSortArrow(buttonSort, activeSort.direction);
      button.classList.toggle('is-active', isActive);
      button.classList.toggle('is-current', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.setAttribute('data-sort-active', isActive ? '1' : '0');
      button.setAttribute('data-sort-direction', isActive ? activeSort.direction : '');
      button.setAttribute('title', isActive ? (baseLabel + ' ' + activeSort.direction) : baseLabel);
      if (label) {
        label.textContent = baseLabel;
      }
      if (arrow) {
        arrow.textContent = isActive ? directionArrow : '';
      }
    });
  }

  function getRecentFilesSort() {
    return readRecentFilesSort();
  }

  function setRecentFilesSort(sort, persist) {
    var normalized = formatRecentFilesSortState(sort);
    var root = getRecentFilesRoot();
    if (!root) return normalized;
    root.setAttribute('data-recent-files-sort', normalized);
    updateRecentFilesSortButtons(normalized);
    if (persist !== false) writeRecentFilesSort(normalized);
    return normalized;
  }

  function getRecentFileItemSignature(item) {
    return [
      item && item.file_path ? item.file_path : '',
      item && item.updated_at ? item.updated_at : '',
      item && item.change_summary ? item.change_summary : '',
      item && item.status ? item.status : '',
    ].join('|');
  }

  function compareRecentFileItems(a, b, sortMode) {
    var sort = normalizeRecentFilesSortState(sortMode);
    var aPath = String(a && a.file_path ? a.file_path : '');
    var bPath = String(b && b.file_path ? b.file_path : '');

    if (sort.key === 'name') {
      var aBase = aPath.split('/').pop() || aPath;
      var bBase = bPath.split('/').pop() || bPath;
      if (aBase !== bBase) return aBase.localeCompare(bBase);
      if (aPath !== bPath) return aPath.localeCompare(bPath);
      return String(a && a.updated_at ? a.updated_at : '').localeCompare(String(b && b.updated_at ? b.updated_at : ''));
    }

    if (sort.key === 'path') {
      var aParts = aPath.split('/');
      var bParts = bPath.split('/');
      var aBasePath = aParts.pop() || aPath;
      var bBasePath = bParts.pop() || bPath;
      var aDir = aParts.join('/');
      var bDir = bParts.join('/');
      if (aDir !== bDir) return aDir.localeCompare(bDir);
      if (aBasePath !== bBasePath) return aBasePath.localeCompare(bBasePath);
      return aPath.localeCompare(bPath);
    }

    var aTime = new Date(a && a.updated_at ? a.updated_at : '').getTime();
    var bTime = new Date(b && b.updated_at ? b.updated_at : '').getTime();
    if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) return bTime - aTime;
    if (Number.isFinite(bTime) && !Number.isFinite(aTime)) return -1;
    if (!Number.isFinite(bTime) && Number.isFinite(aTime)) return 1;
    if (aPath !== bPath) return aPath.localeCompare(bPath);
    return 0;
  }

  function getRecentFilesSortDefaultFor(button) {
    var key = String(button && button.getAttribute('data-recent-files-sort-option') || '').trim().toLowerCase();
    var fallback = getRecentFilesSortDefaults(key);
    var declared = String(button && button.getAttribute('data-recent-files-sort-default') || '').trim().toLowerCase();
    if (declared === 'asc' || declared === 'desc') return declared;
    return fallback;
  }

  function sortRecentFileItems(items, sortMode) {
    var list = Array.isArray(items) ? items.slice() : [];
    var sort = normalizeRecentFilesSortState(sortMode);
    var comparator = function(a, b) {
      return compareRecentFileItems(a, b, sort.key);
    };
    var invert = (sort.key === 'recent' && sort.direction === 'asc') || (sort.key !== 'recent' && sort.direction === 'desc');
    return list.sort(function(a, b) {
      var result = comparator(a, b);
      return invert ? -result : result;
    });
  }

  function getRecentFileOpenPath() {
    var root = getRecentFilesRoot();
    if (!root) return '';
    var selected = root.querySelector('[data-recent-file-item].is-selected');
    return selected ? String(selected.getAttribute('data-file-path') || '').trim() : '';
  }

  function setRecentFilesCount(count) {
    var countEl = getRecentFilesCountEl();
    if (countEl) {
      countEl.textContent = String(Number(count) || 0) + ' items';
    }
  }

  function setRecentFilesEmpty(empty) {
    var list = getRecentFilesList();
    var emptyState = getRecentFilesEmptyState();
    if (list) list.hidden = Boolean(empty);
    if (emptyState) emptyState.hidden = !empty;
  }

  function createRecentFileItem(item, index) {
    var filePath = String(item && item.file_path ? item.file_path : '').trim();
    var fileName = filePath.split('/').pop() || filePath || '(unknown file)';
    var itemNode = document.createElement('div');
    itemNode.className = 'recent-file-item';
    itemNode.setAttribute('data-recent-file-item', '');
    itemNode.setAttribute('data-file-index', String(index));
    itemNode.setAttribute('data-status-label', String(item && (item.status_label || item.status || 'File')));
    itemNode.setAttribute('data-file-path', filePath);
    itemNode.setAttribute('data-file-name', fileName);
    itemNode.setAttribute('data-file-updated-at', String(item && item.updated_at ? item.updated_at : ''));
    itemNode.setAttribute('data-file-updated-label', String(item && item.updated_label ? item.updated_label : ''));
    itemNode.setAttribute('data-file-updated-relative', String(item && item.updated_relative ? item.updated_relative : ''));
    itemNode.setAttribute('data-file-summary', String(item && item.change_summary ? item.change_summary : ''));
    itemNode.setAttribute('aria-expanded', 'false');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'artifact-item artifact-item--button recent-file-item__trigger';
    trigger.setAttribute('data-recent-file-trigger', '');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'recent-file-detail-rail-' + index);

    var left = document.createElement('span');
    left.className = 'recent-file-item__summary-left';

    var status = document.createElement('span');
    status.className = 'recent-file-item__status';
    status.textContent = String(item && (item.status_label || item.status || 'File'));

    var name = document.createElement('strong');
    name.className = 'recent-file-item__name';
    name.textContent = fileName;

    var meta = document.createElement('span');
    meta.className = 'recent-file-item__meta';

    var time = document.createElement('span');
    time.className = 'recent-file-item__time';
    time.textContent = formatDateTime(item && item.updated_at ? item.updated_at : '');

    var relative = document.createElement('span');
    relative.className = 'recent-file-item__relative';
    relative.textContent = formatRelativeTime(item && item.updated_at ? item.updated_at : '');

    meta.appendChild(time);
    meta.appendChild(relative);
    left.appendChild(status);
    left.appendChild(name);
    left.appendChild(meta);

    var right = document.createElement('span');
    right.className = 'recent-file-item__summary-right';
    if (item && item.change_summary) {
      var summary = document.createElement('span');
      summary.className = 'recent-file-item__summary';
      summary.textContent = item.change_summary;
      right.appendChild(summary);
    }
    var chevron = document.createElement('span');
    chevron.className = 'recent-file-item__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    right.appendChild(chevron);

    trigger.appendChild(left);
    trigger.appendChild(right);

    var detail = document.createElement('div');
    detail.className = 'recent-file-item__detail';
    detail.id = 'recent-file-detail-rail-' + index;
    detail.setAttribute('data-recent-file-detail', '');
    detail.setAttribute('aria-hidden', 'true');
    detail.style.maxHeight = '0px';

    var panel = document.createElement('div');
    panel.className = 'recent-file-item__detail-panel';

    var head = document.createElement('div');
    head.className = 'recent-file-item__detail-head';

    var pathNode = document.createElement('code');
    pathNode.className = 'recent-file-item__detail-path recent-file-item__detail-path--full';
    pathNode.textContent = filePath;

    var openLink = document.createElement('a');
    openLink.className = 'btn recent-file-item__open-file-btn';
    openLink.href = buildRecentFileViewerUrl(filePath);
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.setAttribute('aria-label', 'Open full file');
    openLink.title = 'Open full file';
    openLink.textContent = '↗';

    head.appendChild(pathNode);
    head.appendChild(openLink);

    var diff = document.createElement('div');
    diff.className = 'recent-file-item__detail-body recent-file-item__detail-body--diff';
    diff.innerHTML = renderRecentFileDiffMarkup(item && item.change_detail ? item.change_detail : 'No diff available.');

    panel.appendChild(head);
    panel.appendChild(diff);
    detail.appendChild(panel);
    itemNode.appendChild(trigger);
    itemNode.appendChild(detail);
    return itemNode;
  }

  function renderRecentFiles(items, sortMode) {
    var root = getRecentFilesRoot();
    var list = getRecentFilesList();
    if (!root || !list) return false;

    var normalizedSort = setRecentFilesSort(sortMode || getRecentFilesSort(), false);
    var sorted = sortRecentFileItems(items, normalizedSort);
    var signature = normalizedSort + '|' + sorted.map(getRecentFileItemSignature).join('||');
    if (signature === recentFilesLastSignature) return false;
    recentFilesLastSignature = signature;

    var openPath = getRecentFileOpenPath();
    list.innerHTML = '';

    if (!sorted.length) {
      setRecentFilesCount(0);
      setRecentFilesEmpty(true);
      return true;
    }

    var fragment = document.createDocumentFragment();
    sorted.forEach(function(item, index) {
      fragment.appendChild(createRecentFileItem(item, index));
    });
    list.appendChild(fragment);
    setRecentFilesCount(sorted.length);
    setRecentFilesEmpty(false);

    if (openPath) {
      var openItem = Array.prototype.slice.call(list.querySelectorAll('[data-recent-file-item]')).find(function(node) {
        return String(node.getAttribute('data-file-path') || '').trim() === openPath;
      });
      if (openItem) {
        setRecentFileDetailOpen(openItem, true);
      }
    }
    return true;
  }

  function getRecentFilesUrl(sortMode) {
    var root = getRecentFilesRoot();
    if (!root) return '';
    var endpoint = String(root.getAttribute('data-recent-files-url') || '').trim();
    if (!endpoint) return '';
    var url = new URL(endpoint, window.location.origin);
    url.searchParams.set('sort', formatRecentFilesSortState(sortMode || getRecentFilesSort()));
    url.searchParams.set('tab', getActiveTab());
    var limit = Number(root.getAttribute('data-recent-files-limit') || 10);
    if (Number.isFinite(limit) && limit > 0) {
      url.searchParams.set('limit', String(limit));
    }
    return url.toString();
  }

  function stopRecentFilesPolling() {
    if (recentFilesPollTimer) {
      window.clearTimeout(recentFilesPollTimer);
      recentFilesPollTimer = null;
    }
    recentFilesRequestToken += 1;
    recentFilesRequest = null;
  }

  function requestRecentFilesData(url) {
    if (!url) return Promise.resolve(false);
    var requestToken = ++recentFilesRequestToken;
    recentFilesRequest = fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data && Array.isArray(data.files)) {
          renderRecentFiles(data.files, data.sort || getRecentFilesSort());
          return true;
        }
        return false;
      })
      .catch(function(err) {
        console.error('recent files refresh error', err);
        return false;
      })
      .finally(function() {
        if (recentFilesRequestToken === requestToken) {
          recentFilesRequest = null;
        }
      });

    return recentFilesRequest;
  }

  function scheduleRecentFilesPolling() {
    stopRecentFilesPolling();
    if (!hasProjectId() || !getRecentFilesRoot()) return;

    var poll = function() {
      recentFilesPollTimer = null;
      if (!hasProjectId() || !getRecentFilesRoot()) return;
      var url = getRecentFilesUrl();
      if (!url) return;
      if (recentFilesRequest) {
        recentFilesPollTimer = window.setTimeout(poll, RECENT_FILES_POLL_INTERVAL_MS);
        return;
      }

      requestRecentFilesData(url)
        .then(function() {
          recentFilesPollTimer = window.setTimeout(poll, RECENT_FILES_POLL_INTERVAL_MS);
        })
        .catch(function(err) {
          console.error('recent files poll error', err);
          recentFilesPollTimer = window.setTimeout(poll, RECENT_FILES_POLL_INTERVAL_MS);
        });
    };

    recentFilesPollTimer = window.setTimeout(poll, RECENT_FILES_POLL_INTERVAL_MS);
  }

  function refreshRecentFiles(force) {
    var url = getRecentFilesUrl();
    if (!url) return Promise.resolve(false);
    if (!force && recentFilesRequest) return recentFilesRequest;
    return requestRecentFilesData(url);
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

    var visibleText = value.slice(0, MESSAGE_PREVIEW_LIMIT).replace(/\s+$/, '');
    return {
      preview: visibleText + '...',
      full: value,
      truncated: true,
    };
  }

  function appendDetailsSection(parent, className, summaryText, childBuilder) {
    var details = document.createElement('details');
    details.setAttribute('class', className);

    var summary = document.createElement('summary');
    summary.setAttribute('class', 'chat-bubble__summary');
    summary.textContent = summaryText;

    details.appendChild(summary);

    if (typeof childBuilder === 'function') {
      childBuilder(details);
    }

    bindChatBubbleDetail(details);
    parent.appendChild(details);
    syncChatBubbleDetailSummary(details);
    return details;
  }

  function bindChatBubbleDetail(details) {
    if (!details || details.__opsDashboardDetailBound) return;
    details.__opsDashboardDetailBound = true;
    details.addEventListener('toggle', function() {
      syncChatBubbleDetailSummary(details);
    });
  }

  function syncChatBubbleDetailSummary(details) {
    if (!details || !details.classList) return;
    var summary = typeof details.querySelector === 'function' ? details.querySelector('summary') : null;
    if (!summary) return;
    if (details.classList.contains('chat-bubble__details--message')) {
      summary.textContent = details.open ? 'show less' : 'show more';
      return;
    }
    if (details.classList.contains('chat-bubble__details--error')) {
      summary.textContent = details.open ? 'hide error' : 'show error';
    }
  }

  function syncChatBubbleDetailSummaries(root) {
    var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    Array.prototype.slice.call(scope.querySelectorAll('.chat-bubble__details')).forEach(function(details) {
      bindChatBubbleDetail(details);
      syncChatBubbleDetailSummary(details);
    });
  }

  function syncMessageExpander(expander, expanded) {
    if (!expander) return;
    var preview = expander.querySelector('[data-message-preview]');
    var full = expander.querySelector('[data-message-full]');
    var toggle = expander.querySelector('[data-message-toggle]');
    var isExpanded = typeof expanded === 'boolean'
      ? expanded
      : expander.getAttribute('data-expanded') === 'true';

    expander.setAttribute('data-expanded', isExpanded ? 'true' : 'false');
    if (preview) preview.hidden = isExpanded;
    if (full) full.hidden = !isExpanded;
    if (toggle) {
      toggle.textContent = isExpanded ? 'show less' : 'show more';
      toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }
  }

  function toggleMessageExpander(toggle) {
    if (!toggle) return;
    var expander = null;
    if (typeof toggle.closest === 'function') {
      expander = toggle.closest('[data-message-expander]');
    }
    if (!expander) {
      var current = toggle.parentNode || null;
      while (current) {
        if (typeof current.getAttribute === 'function' && current.getAttribute('data-message-expander') !== '') {
          expander = current;
          break;
        }
        if (current.attributes && Object.prototype.hasOwnProperty.call(current.attributes, 'data-message-expander')) {
          expander = current;
          break;
        }
        current = current.parentNode || null;
      }
    }
    if (!expander) return;
    var isExpanded = expander.getAttribute('data-expanded') === 'true';
    syncMessageExpander(expander, !isExpanded);
  }

  function bindMessageToggle(toggle) {
    if (!toggle || toggle.__opsDashboardMessageToggleBound) return;
    toggle.__opsDashboardMessageToggleBound = true;
    toggle.addEventListener('click', function(event) {
      event.preventDefault();
      toggleMessageExpander(toggle);
    });
  }

  function syncMessageExpanders(root) {
    var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    Array.prototype.slice.call(scope.querySelectorAll('[data-message-expander]')).forEach(function(expander) {
      var toggle = expander.querySelector('[data-message-toggle]');
      if (toggle) bindMessageToggle(toggle);
      syncMessageExpander(expander);
    });
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

    if (messageText.truncated) {
      var expander = document.createElement('div');
      expander.className = 'chat-bubble__message-expander';
      expander.setAttribute('data-message-expander', '');
      expander.setAttribute('data-expanded', 'false');

      body.setAttribute('data-message-preview', '');
      var full = document.createElement('pre');
      full.className = 'chat-bubble__body chat-bubble__body--full';
      full.setAttribute('data-message-full', '');
      full.hidden = true;
      full.textContent = messageText.full;

      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'chat-bubble__summary';
      toggle.setAttribute('data-message-toggle', '');
      toggle.setAttribute('aria-expanded', 'false');

      expander.appendChild(body);
      expander.appendChild(full);
      expander.appendChild(toggle);
      bubble.appendChild(expander);
      bindMessageToggle(toggle);
      syncMessageExpander(expander, false);
    } else {
      bubble.appendChild(body);
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

  function renderRecentFileDiffMarkup(value) {
    var lines = String(value || 'No diff available.').replace(/\r\n?/g, '\n').split('\n');
    var classify = function(line) {
      if (!line) return 'blank';
      if (line.indexOf('diff --git') === 0 || line.indexOf('index ') === 0 || line.indexOf('Binary files') === 0) return 'header';
      if (line.indexOf('--- ') === 0) return 'del-file';
      if (line.indexOf('+++ ') === 0) return 'add-file';
      if (line.indexOf('@@') === 0) return 'hunk';
      if (line.indexOf('+') === 0 && line.indexOf('+++') !== 0) return 'add';
      if (line.indexOf('-') === 0 && line.indexOf('---') !== 0) return 'del';
      if (line.indexOf('\\ ') === 0) return 'meta';
      return 'context';
    };

    return lines.map(function(line) {
      var kind = classify(line);
      var text = line ? escapeHtml(line) : '&nbsp;';
      return '<span class="recent-file-diff-line recent-file-diff-line--' + kind + '">' + text + '</span>';
    }).join('');
  }

  function buildRecentFileViewerUrl(filePath) {
    return '/project/' + encodeURIComponent(getProjectId()) + '/file?path=' + encodeURIComponent(String(filePath || ''));
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
    stopRecentFilesPolling();
    recentFilesLastSignature = '';
    currentShell.replaceWith(nextShell.cloneNode(true));
    closeSidebar();
    syncFilterState();
    syncProjectRailWidth();
    rehydratePageModules();
    bindMessageComposer();
    if (hasProjectId()) {
      bindPolling();
      scheduleRecentFilesPolling();
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
    var recentFilesSortButton = e.target.closest('[data-recent-files-sort-option]');
    if (recentFilesSortButton) {
      e.preventDefault();
      var sortKey = String(recentFilesSortButton.getAttribute('data-recent-files-sort-option') || '').trim().toLowerCase();
      var currentSort = normalizeRecentFilesSortState(getRecentFilesSort());
      var nextSort = currentSort.key === sortKey
        ? currentSort.direction === 'asc'
          ? { key: sortKey, direction: 'desc' }
          : { key: sortKey, direction: 'asc' }
        : { key: sortKey, direction: getRecentFilesSortDefaultFor(recentFilesSortButton) };
      setRecentFilesSort(nextSort, true);
      refreshRecentFiles(true);
      return;
    }

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

  function handleDocumentToggle(e) {
    var details = e.target;
    if (!details || !details.classList || !details.classList.contains('chat-bubble__details')) return;
    syncChatBubbleDetailSummary(details);
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
    document.addEventListener('toggle', handleDocumentToggle, true);
    document.addEventListener('pointerdown', startProjectRailResize);
    window.addEventListener('popstate', handlePopState);

    if (window.matchMedia && window.matchMedia('(min-width: 861px)').matches) {
      setDesktopSidebarCollapsed(readDesktopSidebarCollapsed());
    }

    bindMessageComposer();
    syncMessageExpanders();
    syncChatBubbleDetailSummaries();
    wireProjectSettingsWizard();
    syncFilterState();
    syncProjectRailWidth();
    setRecentFilesSort(readRecentFilesSort(), false);
    refreshRecentFiles(true);
    prefetchProjectTabs();
    if (hasProjectId()) {
      bindPolling();
      scheduleRecentFilesPolling();
    } else {
      stopPolling();
      stopRecentFilesPolling();
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
