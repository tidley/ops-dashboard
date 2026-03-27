(function() {
  var STORAGE_PREFIX = 'ops-dashboard.sidebar-section:';

  function getPageKey() {
    return document.body.getAttribute('data-page') || 'app';
  }

  function storageKey(sectionKey) {
    return STORAGE_PREFIX + getPageKey() + ':' + sectionKey;
  }

  function readCollapsed(sectionKey) {
    try {
      return window.localStorage.getItem(storageKey(sectionKey)) === '1';
    } catch {
      return false;
    }
  }

  function writeCollapsed(sectionKey, collapsed) {
    try {
      window.localStorage.setItem(storageKey(sectionKey), collapsed ? '1' : '0');
    } catch {
      // Ignore storage failures in private mode / restricted environments.
    }
  }

  function setSectionCollapsed(section, collapsed) {
    var button = section.querySelector('[data-sidebar-collapse]');
    var body = section.querySelector('[data-sidebar-body]');
    section.classList.toggle('sidebar-section--collapsed', collapsed);
    if (button) button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (body) body.hidden = Boolean(collapsed);
  }

  function initSection(section) {
    var sectionKey = section.getAttribute('data-sidebar-section-key');
    if (!sectionKey) return;

    var button = section.querySelector('[data-sidebar-collapse]');
    if (!button) return;

    var collapsed = readCollapsed(sectionKey);
    setSectionCollapsed(section, collapsed);

    button.addEventListener('click', function() {
      var nextCollapsed = !section.classList.contains('sidebar-section--collapsed');
      setSectionCollapsed(section, nextCollapsed);
      writeCollapsed(sectionKey, nextCollapsed);
    });
  }

  function init() {
    document.querySelectorAll('[data-sidebar-collapsible]').forEach(initSection);
  }

  init();
})();
