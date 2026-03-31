const { execFile } = require('child_process');

const WINDOW_REGISTRY_KEY = 'vibez.windowRegistry';
const WINDOW_REGISTRY_TTL_MS = 30 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function isLiveTimestamp(value, ttlMs = WINDOW_REGISTRY_TTL_MS) {
  const timestamp = new Date(value || 0).getTime();
  if (Number.isNaN(timestamp)) return false;
  return (Date.now() - timestamp) <= ttlMs;
}

function readWindowRegistry(context) {
  const value = context.globalState.get(WINDOW_REGISTRY_KEY, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function writeWindowRegistry(context, registry) {
  await context.globalState.update(WINDOW_REGISTRY_KEY, registry || {});
}

function listLiveWindows(context, ttlMs = WINDOW_REGISTRY_TTL_MS) {
  const registry = readWindowRegistry(context);
  return Object.entries(registry)
    .filter(([, entry]) => entry && isLiveTimestamp(entry.lastSeenAt, ttlMs))
    .map(([projectPath, entry]) => ({ projectPath, ...entry }));
}

function getLiveWindowForProject(context, projectPath, ttlMs = WINDOW_REGISTRY_TTL_MS) {
  return listLiveWindows(context, ttlMs).find((entry) => entry.projectPath === projectPath) || null;
}

async function markWindowAlive(context, { projectPath, windowSessionId }) {
  if (!projectPath || !windowSessionId) return null;
  const registry = readWindowRegistry(context);
  registry[projectPath] = {
    windowSessionId,
    lastSeenAt: nowIso(),
  };
  await writeWindowRegistry(context, registry);
  return registry[projectPath];
}

async function clearWindowAlive(context, { projectPath, windowSessionId }) {
  if (!projectPath || !windowSessionId) return;
  const registry = readWindowRegistry(context);
  const entry = registry[projectPath];
  if (!entry || entry.windowSessionId !== windowSessionId) return;
  delete registry[projectPath];
  await writeWindowRegistry(context, registry);
}

function buildCodeLaunchArgs(projectPath, options = {}) {
  const args = [];
  if (options.newWindow) args.push('--new-window');
  if (options.reuseWindow) args.push('--reuse-window');
  if (options.userDataDir) args.push('--user-data-dir', options.userDataDir);
  if (options.profile) args.push('--profile', options.profile);
  if (options.skipRecent) args.push('--skip-add-to-recently-opened');
  args.push(projectPath);
  return args;
}

function launchCodeWindow(cliPath, projectPath, options = {}) {
  return new Promise((resolve) => {
    const args = buildCodeLaunchArgs(projectPath, options);
    const child = execFile(cliPath, args, {
      detached: true,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          error,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
        return;
      }

      resolve({
        ok: true,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });

    if (child && typeof child.unref === 'function') {
      child.unref();
    }
  });
}

module.exports = {
  WINDOW_REGISTRY_TTL_MS,
  buildCodeLaunchArgs,
  clearWindowAlive,
  getLiveWindowForProject,
  launchCodeWindow,
  listLiveWindows,
  markWindowAlive,
};
