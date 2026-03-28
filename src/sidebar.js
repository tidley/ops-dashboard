function safeDateMs(value) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getProjectActivityMs(project) {
  return safeDateMs(project.ui_state?.last_opened_at || project.last_activity || project.created_at);
}

function sortByLastOpenedDesc(projects) {
  return projects.slice().sort((a, b) => {
    const aOpened = getProjectActivityMs(a);
    const bOpened = getProjectActivityMs(b);
    if (aOpened !== bOpened) return bOpened - aOpened;
    return `${a.name || ''}`.localeCompare(`${b.name || ''}`);
  });
}

function sortAlphabetical(projects) {
  return projects.slice().sort((a, b) => {
    const nameCmp = `${a.name || ''}`.localeCompare(`${b.name || ''}`);
    if (nameCmp !== 0) return nameCmp;
    return safeDateMs(b.ui_state?.last_opened_at || b.last_activity || b.created_at) -
      safeDateMs(a.ui_state?.last_opened_at || a.last_activity || a.created_at);
  });
}

function buildProjectGroups(projects) {
  const projectList = Array.isArray(projects) ? projects.slice() : [];
  const archived = sortByLastOpenedDesc(projectList.filter(project => project.archived));
  const activeProjects = projectList.filter(project => !project.archived);
  const favourites = activeProjects.filter(project => project.favorite);
  const recentWindowMs = 48 * 60 * 60 * 1000;
  const cutoffMs = Date.now() - recentWindowMs;
  const recent = sortByLastOpenedDesc(
    activeProjects.filter(project => !project.favorite && getProjectActivityMs(project) >= cutoffMs),
  );

  const excludedIds = new Set([
    ...favourites.map(project => project.id),
    ...recent.map(project => project.id),
  ]);

  const remaining = activeProjects.filter(project => !excludedIds.has(project.id));

  return {
    recent,
    favourites: sortByLastOpenedDesc(favourites),
    general: sortAlphabetical(remaining.filter(project => project.section === 'general')),
    pave: sortAlphabetical(remaining.filter(project => project.section === 'pave')),
    sec06: sortAlphabetical(remaining.filter(project => project.section === 'sec06')),
    archived,
  };
}

module.exports = {
  buildProjectGroups,
  sortByLastOpenedDesc,
  sortAlphabetical,
};
