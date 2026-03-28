#!/usr/bin/env node
const Store = require('./src/store').default;
const store = new Store({ dataDir: './data' });
const projectId = process.argv[2];
const project = store.getProject(projectId);
console.log('Project:', JSON.stringify(project, null, 2));

function resolveProjectRoot(project) {
  const direct = project?.settings_json?.imported_from || project?.workspace_dir || '';
  if (direct) return direct;

  const description = String(project?.description || '');
  const importedFromMatch = description.match(/Imported from\s+([^\n]+)/i);
  if (importedFromMatch && importedFromMatch[1]) {
    return importedFromMatch[1].trim();
  }

  return '';
}

console.log('Resolved root:', resolveProjectRoot(project));