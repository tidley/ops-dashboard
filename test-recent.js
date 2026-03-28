#!/usr/bin/env node
const store = require('./src/store');
const { execSync } = require('child_process');

function buildRecentFileChanges(project, limit = 10) {
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

  const root = resolveProjectRoot(project);
  console.log('Root:', root);
  if (!root) return [];

  const max = Math.max(1, Number(limit) || 10);
  const items = [];
  const seen = new Set();

  try {
    const statusRaw = execSync(`git -C ${JSON.stringify(root)} status --porcelain=v1 --untracked-files=all`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    console.log('git status output:', statusRaw.trim());

    String(statusRaw || '')
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .forEach(line => {
        const status = (line.slice(0, 2).trim() || '??').toUpperCase();
        let filePath = line.slice(3).trim();
        if (filePath.includes(' -> ')) {
          filePath = filePath.split(' -> ').pop().trim();
        }
        if (!filePath || seen.has(filePath)) return;
        seen.add(filePath);
        items.push({ status, file_path: filePath });
      });
  } catch (err) {
    console.error('git status error:', err);
    return [];
  }

  try {
    const headFilesRaw = execSync(`git -C ${JSON.stringify(root)} show --name-only --pretty=format: -n 1 HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    String(headFilesRaw || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(filePath => {
        if (seen.has(filePath)) return;
        seen.add(filePath);
        items.push({ status: 'HEAD', file_path: filePath });
      });
  } catch {
    // ignore
  }

  return items.slice(0, max);
}

const project = store.getProject('proj-622cee69');
const changes = buildRecentFileChanges(project, 8);
console.log('Recent changes:', JSON.stringify(changes, null, 2));