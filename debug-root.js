#!/usr/bin/env node
const store = require('./src/store');
const project = store.getProject('proj-622cee69');

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

console.log('Project:', {
  name: project.name,
  description: project.description,
  settings_json: project.settings_json,
  workspace_dir: project.workspace_dir
});
console.log('Resolved root:', resolveProjectRoot(project));
