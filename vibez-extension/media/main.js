(function() {
  var vscode = window.VIBEZ_API;
  var state = null;
  var search = '';
  var selectedProjectId = '';

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function send(message) {
    vscode.postMessage(message);
  }

  function formatDate(value) {
    if (!value) return 'Never';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString();
  }

  function filterProjects(projects) {
    var normalized = String(search || '').trim().toLowerCase();
    if (!normalized) return projects.slice();
    return projects.filter(function(project) {
      return [
        project.name,
        project.path,
        project.relativePath,
        project.branch,
        project.lastCommitSubject,
      ].join(' ').toLowerCase().indexOf(normalized) >= 0;
    });
  }

  function allProjects() {
    if (!state) return [];
    return []
      .concat(state.groups.pinned || [])
      .concat(state.groups.recents || [])
      .concat(state.groups.others || [])
      .filter(function(project, index, list) {
        return list.findIndex(function(candidate) { return candidate.id === project.id; }) === index;
      });
  }

  function selectedProject() {
    var projects = allProjects();
    return projects.find(function(project) { return project.id === selectedProjectId; }) || projects[0] || null;
  }

  function ensureSelection() {
    var current = selectedProject();
    if (current) {
      selectedProjectId = current.id;
      return;
    }
    var projects = allProjects();
    selectedProjectId = projects.length ? projects[0].id : '';
  }

  function projectBadges(project) {
    var badges = [];
    if (project.dirtyCount) badges.push('<span class="badge badge--dirty">' + project.dirtyCount + ' dirty</span>');
    if (project.untrackedCount) badges.push('<span class="badge badge--dirty">' + project.untrackedCount + ' new</span>');
    if (project.ahead) badges.push('<span class="badge badge--ahead">+' + project.ahead + '</span>');
    if (project.behind) badges.push('<span class="badge badge--behind">-' + project.behind + '</span>');
    if (project.tmuxSessionName) badges.push('<span class="badge">' + escapeHtml(project.tmuxSessionName) + '</span>');
    return badges.join('');
  }

  function renderRow(project) {
    var branch = project.branch
      ? '<span class="branch"><span class="branch__dot"></span>' + escapeHtml(project.branch) + '</span>'
      : '<span class="meta">No git branch</span>';
    var current = project.current ? '<span class="row__current">Current</span>' : '';
    var commit = project.lastCommitSubject
      ? escapeHtml(project.lastCommitSubject + (project.lastCommitRelative ? ' • ' + project.lastCommitRelative : ''))
      : 'No recent commit';
    var selectedClass = project.id === selectedProjectId ? ' is-selected' : '';
    var pinClass = project.pinned ? ' is-active' : '';

    return '' +
      '<div class="row' + selectedClass + '">' +
        '<div class="row__identity">' +
          '<button type="button" data-select-project="' + escapeHtml(project.id) + '">' +
            '<div class="row__namebar">' +
              '<span class="row__name">' + escapeHtml(project.name) + '</span>' +
              current +
            '</div>' +
            '<div class="row__path">' + escapeHtml(project.relativePath) + '</div>' +
            '<div class="row__commit">' + commit + '</div>' +
          '</button>' +
        '</div>' +
        '<div>' + branch + '</div>' +
        '<div class="badges">' + projectBadges(project) + '</div>' +
        '<div class="row__actions">' +
          '<button type="button" class="pin' + pinClass + '" data-pin-project="' + escapeHtml(project.path) + '" title="Toggle pin">★</button>' +
          '<button type="button" class="row__action" data-attach-project="' + escapeHtml(project.path) + '">Attach</button>' +
          '<button type="button" class="row__action row__action--primary" data-switch-project="' + escapeHtml(project.path) + '">Switch</button>' +
        '</div>' +
      '</div>';
  }

  function renderGroup(title, projects) {
    var filtered = filterProjects(projects);
    if (!filtered.length) return '';
    return '' +
      '<section class="group">' +
        '<div class="group__header"><span>' + escapeHtml(title) + '</span><span>' + filtered.length + '</span></div>' +
        '<div class="table">' + filtered.map(renderRow).join('') + '</div>' +
      '</section>';
  }

  function renderDetail(project) {
    if (!project) {
      return '<div class="detail"><div class="empty">No projects found in the configured code directory.</div></div>';
    }

    return '' +
      '<aside class="detail">' +
        '<div class="detail__panel">' +
          '<div class="detail__header">' +
            '<h2>' + escapeHtml(project.name) + '</h2>' +
            '<p>' + escapeHtml(project.path) + '</p>' +
          '</div>' +
          '<div class="detail__actions">' +
            '<button type="button" class="detail__button detail__button--primary" data-switch-project="' + escapeHtml(project.path) + '">Switch Workspace</button>' +
            '<button type="button" class="detail__button" data-attach-project="' + escapeHtml(project.path) + '">Attach tmux Session</button>' +
            '<button type="button" class="detail__button" data-pin-project="' + escapeHtml(project.path) + '">Toggle Pin</button>' +
          '</div>' +
          '<section class="detail__section">' +
            '<h3>Workspace</h3>' +
            '<div class="detail__grid">' +
              '<div class="detail__item"><strong>Relative Path</strong><span>' + escapeHtml(project.relativePath) + '</span></div>' +
              '<div class="detail__item"><strong>Last Opened</strong><span>' + escapeHtml(formatDate(project.lastOpenedAt || project.lastSwitchedAt)) + '</span></div>' +
              '<div class="detail__item"><strong>Branch</strong><span>' + escapeHtml(project.branch || 'Not a git repo') + '</span></div>' +
              '<div class="detail__item"><strong>tmux Session</strong><span>' + escapeHtml(project.tmuxSessionName || 'Disabled') + '</span></div>' +
            '</div>' +
          '</section>' +
          '<section class="detail__section">' +
            '<h3>Repository</h3>' +
            '<div class="detail__grid">' +
              '<div class="detail__item"><strong>Last Commit</strong><span>' + escapeHtml(project.lastCommitSubject || 'No commit info') + '</span></div>' +
              '<div class="detail__item"><strong>Commit Age</strong><span>' + escapeHtml(project.lastCommitRelative || 'Unknown') + '</span></div>' +
              '<div class="detail__item"><strong>Dirty Files</strong><span>' + escapeHtml(String(project.dirtyCount || 0)) + '</span></div>' +
              '<div class="detail__item"><strong>Switch Count</strong><span>' + escapeHtml(String(project.switchCount || 0)) + '</span></div>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</aside>';
  }

  function render() {
    var app = byId('app');
    if (!state) {
      app.innerHTML = '<div class="loading">Loading Vibez…</div>';
      return;
    }

    ensureSelection();
    var selected = selectedProject();

    app.innerHTML = '' +
      '<div class="shell">' +
        '<main class="main">' +
          '<div class="toolbar">' +
            '<div class="toolbar__top">' +
              '<div class="title">' +
                '<span class="title__mark"></span>' +
                '<div><h1>Vibez</h1><p>' + escapeHtml(state.codeDirectory || 'No code directory configured') + '</p></div>' +
              '</div>' +
              '<div class="actions">' +
                '<button type="button" class="button" id="pick-dir-btn">Code Directory</button>' +
                '<button type="button" class="button" id="refresh-btn">Refresh</button>' +
              '</div>' +
            '</div>' +
            '<div class="toolbar__bottom">' +
              '<div class="toolbar__search"><input id="search-input" class="search" type="search" placeholder="Search projects, paths, branches…" value="' + escapeHtml(search) + '" /></div>' +
              '<div class="stats">' +
                '<div class="stat"><strong>' + escapeHtml(String(state.projectCount || 0)) + '</strong><span>Projects</span></div>' +
                '<div class="stat"><strong>' + escapeHtml(String(state.pinnedCount || 0)) + '</strong><span>Pinned</span></div>' +
                '<div class="stat"><strong>' + escapeHtml(String(state.recentCount || 0)) + '</strong><span>Recent</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="groups">' +
            renderGroup('Pinned', state.groups.pinned || []) +
            renderGroup('Recent', state.groups.recents || []) +
            renderGroup('Projects', state.groups.others || []) +
          '</div>' +
        '</main>' +
        renderDetail(selected) +
      '</div>';

    bind();
  }

  function bind() {
    var searchInput = byId('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function(event) {
        search = event.target.value || '';
        render();
      });
    }

    var refreshBtn = byId('refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', function() { send({ type: 'refresh' }); });

    var pickDirBtn = byId('pick-dir-btn');
    if (pickDirBtn) pickDirBtn.addEventListener('click', function() { send({ type: 'pickCodeDirectory' }); });

    Array.prototype.slice.call(document.querySelectorAll('[data-select-project]')).forEach(function(button) {
      button.addEventListener('click', function() {
        selectedProjectId = button.getAttribute('data-select-project') || '';
        render();
      });
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-pin-project]')).forEach(function(button) {
      button.addEventListener('click', function() {
        send({ type: 'togglePin', projectPath: button.getAttribute('data-pin-project') || '' });
      });
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-switch-project]')).forEach(function(button) {
      button.addEventListener('click', function() {
        send({ type: 'switchProject', projectPath: button.getAttribute('data-switch-project') || '' });
      });
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-attach-project]')).forEach(function(button) {
      button.addEventListener('click', function() {
        send({ type: 'attachProjectTerminal', projectPath: button.getAttribute('data-attach-project') || '' });
      });
    });
  }

  window.addEventListener('message', function(event) {
    var message = event.data || {};
    if (message.type !== 'state') return;
    state = message.payload || null;
    render();
  });

  send({ type: 'ready' });
})();
