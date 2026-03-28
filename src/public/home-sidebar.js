(function() {
  var SIDEBAR_STORAGE_KEY = 'ops-dashboard.sidebar-collapsed';
  var HOME_SIDEBAR_ENDPOINT = '/api/home/sidebar';
  var HOME_SIDEBAR_SECTION_ORDER = ['recent', 'general', 'pave', 'sec06', 'archived'];

  function isDesktop() {
    return window.matchMedia && window.matchMedia('(min-width: 861px)').matches;
  }

  function readCollapsed() {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function writeCollapsed(collapsed) {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }

  function setDesktopCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', Boolean(collapsed));
    var button = document.querySelector('[data-sidebar-desktop-toggle]');
    if (button) button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function setOpen(open) {
    document.body.classList.toggle('sidebar-open', Boolean(open));
    var button = document.querySelector('[data-sidebar-toggle]');
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function getProjectSearchText(project) {
    return [
      project.name,
      project.id,
      project.status,
      project.sectionLabel,
      project.favorite ? 'favourite pinned' : '',
      project.archived ? 'archived' : '',
      project.session_count,
      project.workflow_count,
      project.activityLabel,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function createTextElement(tagName, className, text) {
    var el = document.createElement(tagName);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function createProjectActionForm(project, favorite, returnTo) {
    var form = document.createElement('form');
    form.method = 'post';
    form.action = '/api/projects/' + encodeURIComponent(project.id) + '/favorite';
    form.className = 'project-item__pin-form';

    var favoriteInput = document.createElement('input');
    favoriteInput.type = 'hidden';
    favoriteInput.name = 'favorite';
    favoriteInput.value = favorite ? '0' : '1';
    form.appendChild(favoriteInput);

    var returnInput = document.createElement('input');
    returnInput.type = 'hidden';
    returnInput.name = 'return_to';
    returnInput.value = returnTo;
    form.appendChild(returnInput);

    var button = document.createElement('button');
    button.type = 'submit';
    button.className = 'project-item__pin-btn';
    button.setAttribute('aria-label', favorite ? 'Remove from favourites' : 'Add to favourites');
    button.setAttribute('title', favorite ? 'Remove from favourites' : 'Add to favourites');

    var icon = document.createElement('svg');
    icon.className = 'project-item__pin-icon';
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');

    var path = document.createElement('path');
    path.setAttribute('d', 'M9 3h6l.8 5.2c.1.6.4 1.2.9 1.6l1.8 1.5c.3.2.5.6.5 1v1.2H14l-1 8-1-8H4.8v-1.2c0-.4.2-.7.5-1l1.8-1.5c.5-.4.8-1 .9-1.6L9 3zm1.8 1.8-.5 3.4c-.2 1-.6 1.9-1.3 2.7l-.7.7h7.4l-.7-.7c-.7-.7-1.1-1.7-1.3-2.7l-.5-3.4h-2.4z');
    icon.appendChild(path);
    button.appendChild(icon);
    form.appendChild(button);
    return form;
  }

  function createArchiveForm(project, returnTo) {
    var form = document.createElement('form');
    form.method = 'post';
    form.action = '/api/projects/' + encodeURIComponent(project.id) + '/archive';
    form.className = 'project-item__archive-form';

    var archivedInput = document.createElement('input');
    archivedInput.type = 'hidden';
    archivedInput.name = 'archived';
    archivedInput.value = '1';
    form.appendChild(archivedInput);

    var returnInput = document.createElement('input');
    returnInput.type = 'hidden';
    returnInput.name = 'return_to';
    returnInput.value = returnTo;
    form.appendChild(returnInput);

    var button = document.createElement('button');
    button.type = 'submit';
    button.className = 'project-item__archive-btn';
    button.setAttribute('aria-label', 'Archive project');
    button.setAttribute('title', 'Archive');
    button.textContent = 'Archive';
    form.appendChild(button);
    return form;
  }

  function createProjectItem(project, activeProjectId, returnTo) {
    var item = document.createElement('div');
    var isFavorite = Boolean(project.favorite);
    item.className = 'project-item' + (isFavorite ? ' project-item--favorite' : '');
    item.setAttribute('data-project-item', '');
    item.setAttribute('data-project-search', getProjectSearchText(project));

    var content = document.createElement('div');
    content.className = 'project-item__content';

    var link = document.createElement('a');
    link.className = 'project-item__link';
    link.href = '/project/' + encodeURIComponent(project.id);

    var top = document.createElement('span');
    top.className = 'project-item__top';

    var strong = document.createElement('strong');
    strong.textContent = project.name || '';
    top.appendChild(strong);

    var badge = document.createElement('span');
    badge.className = 'badge badge-neutral';
    badge.textContent = project.sectionLabel || '';
    top.appendChild(badge);

    var sub = createTextElement(
      'span',
      'project-item__sub',
      (project.status || '') + ' | ' + Number(project.session_count || 0) + ' sessions | ' + Number(project.workflow_count || 0) + ' workflows',
    );

    var foot = createTextElement('span', 'project-item__foot', project.activityLabel || '');
    link.appendChild(top);
    link.appendChild(sub);
    link.appendChild(foot);
    content.appendChild(link);
    item.appendChild(content);
    item.appendChild(createProjectActionForm(project, isFavorite, returnTo));
    item.appendChild(createArchiveForm(project, returnTo));
    return item;
  }

  function getSidebarSection(root, key) {
    return root.querySelector('[data-sidebar-section-key="' + key + '"]');
  }

  function loadSidebarSection(section, projects, activeProjectId, returnTo) {
    if (!section) return;
    var body = section.querySelector('[data-sidebar-body]');
    if (!body) return;
    body.textContent = '';

    if (!projects.length) {
      section.remove();
      return;
    }

    projects.forEach(function(project) {
      body.appendChild(createProjectItem(project, activeProjectId, returnTo));
    });

    section.setAttribute('data-project-section', '');
    section.setAttribute('data-sidebar-lazy-loaded', 'true');
  }

  async function hydrateHomeSidebar(root) {
    if (!root || root.getAttribute('data-home-sidebar-lazy') !== 'true') return;

    var endpoint = root.getAttribute('data-home-sidebar-endpoint') || HOME_SIDEBAR_ENDPOINT;
    var activeProjectId = root.getAttribute('data-active-project-id') || '';
    var returnTo = '/';
    var loaded = false;

    try {
      var response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      var payload = await response.json();
      var sections = payload && payload.sections ? payload.sections : {};
      activeProjectId = payload && payload.activeProjectId ? payload.activeProjectId : activeProjectId;

      for (var i = 0; i < HOME_SIDEBAR_SECTION_ORDER.length; i += 1) {
        var key = HOME_SIDEBAR_SECTION_ORDER[i];
        var section = getSidebarSection(root, key);
        if (!section) continue;
        var projects = Array.isArray(sections[key]) ? sections[key] : [];
        loadSidebarSection(section, projects, activeProjectId, returnTo);
        if (typeof root.__projectFilterRefresh === 'function') {
          root.__projectFilterRefresh();
        }
        await new Promise(function(resolve) {
          if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function() {
              resolve();
            });
            return;
          }
          setTimeout(resolve, 0);
        });
      }
      loaded = true;
    } catch {
      // Leave the loading shells visible if the sidebar payload cannot be fetched.
    } finally {
      if (loaded) {
        root.setAttribute('data-sidebar-loaded', 'true');
      }
      if (typeof root.__projectFilterRefresh === 'function') {
        root.__projectFilterRefresh();
      }
    }
  }

  function init() {
    var button = document.querySelector('[data-sidebar-toggle]');
    var desktopButton = document.querySelector('[data-sidebar-desktop-toggle]');
    var backdrop = document.querySelector('[data-sidebar-backdrop]');
    if (!button || !backdrop) return;

    button.addEventListener('click', function() {
      setOpen(!document.body.classList.contains('sidebar-open'));
    });

    if (desktopButton) {
      var collapsed = readCollapsed();
      setDesktopCollapsed(collapsed);
      desktopButton.addEventListener('click', function() {
        var nextCollapsed = !document.body.classList.contains('sidebar-collapsed');
        setDesktopCollapsed(nextCollapsed);
        writeCollapsed(nextCollapsed);
      });
    }

    backdrop.addEventListener('click', function() {
      setOpen(false);
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setOpen(false);
    });

    var homeSidebarRoot = document.querySelector('[data-home-sidebar-lazy="true"]');
    if (homeSidebarRoot && !homeSidebarRoot.dataset.sidebarLazyInit) {
      homeSidebarRoot.dataset.sidebarLazyInit = '1';
      hydrateHomeSidebar(homeSidebarRoot);
    }
  }

  init();
})();
