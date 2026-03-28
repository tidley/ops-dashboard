(function() {
  var STORAGE_PREFIX = 'ops-dashboard.sidebar-section:';
  var FAVORITE_FORM_SELECTOR = 'form.project-item__pin-form';
  var FAVORITE_SECTION_KEY = 'favourites';
  var RECENT_SECTION_KEY = 'recent';
  var PROJECTS_SECTION_KEY = 'projects';

  function getPageKey() {
    return document.body.getAttribute('data-page') || 'app';
  }

  function storageKey(sectionKey) {
    return STORAGE_PREFIX + getPageKey() + ':' + sectionKey;
  }

  function readCollapsed(sectionKey) {
    try {
      var stored = window.localStorage.getItem(storageKey(sectionKey));
      if (stored === null) {
        return false;
      }
      return stored === '1';
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
    if (section.hasAttribute('data-project-rail')) {
      document.body.classList.toggle('project-rail-collapsed', Boolean(collapsed));
    }
  }

  function getSidebarContainer(root) {
    return root.querySelector('[data-sidebar-scroll]') || root;
  }

  function getSidebarSection(root, key) {
    return root.querySelector('[data-sidebar-section-key="' + key + '"]');
  }

  function getSidebarSectionBody(root, key) {
    var section = getSidebarSection(root, key);
    return section ? section.querySelector('[data-sidebar-body]') : null;
  }

  function createSidebarSection(key, title) {
    var section = document.createElement('section');
    section.className = 'sidebar-section sidebar-section--collapsible';
    section.setAttribute('data-sidebar-collapsible', '');
    section.setAttribute('data-sidebar-section-key', key);
    section.setAttribute('data-project-section', '');

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sidebar-section__titlebar';
    button.setAttribute('data-sidebar-collapse', '');
    button.setAttribute('aria-expanded', 'true');

    var titleSpan = document.createElement('span');
    titleSpan.className = 'sidebar-section__title';
    titleSpan.textContent = title;

    var chevron = document.createElement('span');
    chevron.className = 'sidebar-section__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';

    var body = document.createElement('div');
    body.className = 'project-list';
    body.setAttribute('data-project-group', '');
    body.setAttribute('data-sidebar-body', '');

    button.appendChild(titleSpan);
    button.appendChild(chevron);
    section.appendChild(button);
    section.appendChild(body);
    return section;
  }

  function ensureSidebarSection(root, key, title) {
    var section = getSidebarSection(root, key);
    if (section) return section;
    var container = getSidebarContainer(root);
    var created = createSidebarSection(key, title);
    var anchor = null;
    if (key === FAVORITE_SECTION_KEY) {
      anchor = getSidebarSection(root, RECENT_SECTION_KEY) || getSidebarSection(root, PROJECTS_SECTION_KEY);
    } else if (key === RECENT_SECTION_KEY) {
      anchor = getSidebarSection(root, PROJECTS_SECTION_KEY);
    }
    if (anchor && anchor.parentNode === container) {
      container.insertBefore(created, anchor);
    } else {
      container.appendChild(created);
    }
    if (window.OpsDashboardSidebarSections && typeof window.OpsDashboardSidebarSections.initSection === 'function') {
      window.OpsDashboardSidebarSections.initSection(created);
    }
    return created;
  }

  function removeSidebarSectionIfEmpty(section) {
    if (!section) return;
    var body = section.querySelector('[data-sidebar-body]');
    if (body && body.children.length === 0) {
      section.remove();
    }
  }

  function setFavoriteButtonState(item, favorite) {
    if (!item) return;
    item.classList.toggle('project-item--favorite', Boolean(favorite));

    var form = item.querySelector(FAVORITE_FORM_SELECTOR);
    if (!form) return;

    var hidden = form.querySelector('input[name="favorite"]');
    if (hidden) hidden.value = favorite ? '0' : '1';

    var button = form.querySelector('button[type="submit"]');
    if (button) {
      var label = favorite ? 'Remove from favourites' : 'Add to favourites';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
  }

  function targetSectionForFavorite(root, favorite) {
    if (favorite) {
      return ensureSidebarSection(root, FAVORITE_SECTION_KEY, 'Pinned');
    }

    var recentSection = getSidebarSection(root, RECENT_SECTION_KEY);
    if (recentSection) return recentSection;
    return ensureSidebarSection(root, PROJECTS_SECTION_KEY, 'Projects');
  }

  function moveProjectItem(item, targetSection) {
    if (!item || !targetSection) return;
    var body = targetSection.querySelector('[data-sidebar-body]');
    if (!body) return;
    body.appendChild(item);
  }

  function handleFavoriteSubmit(event) {
    var form = event.target;
    if (!form || !form.matches || !form.matches(FAVORITE_FORM_SELECTOR)) return;

    event.preventDefault();
    if (form.dataset.busy === '1') return;

    var item = form.closest('[data-project-item]');
    var root = form.closest('[data-project-filter-root]');
    if (!item || !root) return;
    var sourceSection = item.closest('[data-sidebar-collapsible]');

    form.dataset.busy = '1';
    var submitter = event.submitter || form.querySelector('button[type="submit"]');
    if (submitter) submitter.disabled = true;

    var favoriteInput = form.querySelector('input[name="favorite"]');
    var favorite = Boolean(favoriteInput && ['1', 'true', 'on', 'yes'].includes(String(favoriteInput.value || '').toLowerCase()));

    var body = new FormData(form);
    fetch(form.action, {
      method: 'POST',
      body: body,
      credentials: 'same-origin',
      headers: {
        Accept: 'text/html,application/json',
      },
    }).then(function(response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      setFavoriteButtonState(item, favorite);
      var targetSection = targetSectionForFavorite(root, favorite);
      moveProjectItem(item, targetSection);

      if (sourceSection) {
        removeSidebarSectionIfEmpty(sourceSection);
      }
    }).catch(function() {
      // Leave the UI unchanged if the request fails.
    }).finally(function() {
      form.dataset.busy = '0';
      if (submitter) submitter.disabled = false;
    });
  }

  function initSection(section) {
    var sectionKey = section.getAttribute('data-sidebar-section-key');
    if (!sectionKey) return;

    var button = section.querySelector('[data-sidebar-collapse]');
    if (!button) return;

    var defaultCollapsed = section.getAttribute('data-sidebar-default-collapsed') === 'true';
    var collapsed;
    try {
      var stored = window.localStorage.getItem(storageKey(sectionKey));
      collapsed = stored === null ? defaultCollapsed : stored === '1';
    } catch {
      collapsed = defaultCollapsed;
    }
    setSectionCollapsed(section, collapsed);

    button.addEventListener('click', function() {
      var nextCollapsed = !section.classList.contains('sidebar-section--collapsed');
      setSectionCollapsed(section, nextCollapsed);
      writeCollapsed(sectionKey, nextCollapsed);
    });
  }

  function init() {
    document.querySelectorAll('[data-sidebar-collapsible]').forEach(initSection);
    if (!window.__opsDashboardFavoriteFormBound) {
      window.__opsDashboardFavoriteFormBound = true;
      document.addEventListener('submit', handleFavoriteSubmit, true);
    }
  }

  init();

  window.OpsDashboardSidebarSections = {
    init: init,
    initSection: initSection,
    setSectionCollapsed: setSectionCollapsed,
  };
})();
