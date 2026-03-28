#!/usr/bin/env node
const project = {
  settings_json: { imported_from: "/home/tom/code/ops-dashboard" },
  workspace_dir: "/home/tom/code/ops-dashboard/storage/projects/proj-622cee69",
  description: "Imported from /home/tom/code/ops-dashboard"
};

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

console.log('Resolved:', resolveProjectRoot(project));
