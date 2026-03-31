const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function sanitizeSlug(value, fallback = 'workspace') {
  const slug = `${value || ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function preferredPortForProject(projectId, basePort = 18081, spread = 400) {
  const text = `${projectId || ''}`;
  let total = 0;
  for (let idx = 0; idx < text.length; idx += 1) {
    total = (total * 33 + text.charCodeAt(idx)) % spread;
  }
  return basePort + total;
}

function probePort(host, port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let finished = false;

    const done = (result) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

async function findAvailablePort(host, startPort, attempts = 50) {
  let port = Math.max(1024, Number(startPort) || 18081);
  for (let idx = 0; idx < attempts; idx += 1, port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const occupied = await probePort(host, port);
    if (!occupied) return port;
  }
  throw new Error(`No available port found starting at ${startPort}`);
}

async function waitForPort(host, port, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const listening = await probePort(host, port, 300);
    if (listening) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function resolveWorkspaceRuntimeDirs({ projectId, projectName }) {
  const homeDir = process.env.HOME || os.homedir() || '/tmp';
  const globalCodeServerRoot = process.env.CODE_SERVER_GLOBAL_DATA_DIR
    || path.join(homeDir, '.local', 'share', 'code-server');
  const slug = sanitizeSlug(projectName || projectId || 'workspace');
  const suffix = `${projectId || ''}`.trim().slice(-6) || 'local';
  const instanceRoot = path.join(homeDir, '.local', 'share', 'vibez-workspaces', `${slug}-${suffix}`);

  return {
    instanceRoot,
    userDataDir: path.join(instanceRoot, 'user-data'),
    sharedExtensionsDir: process.env.CODE_SERVER_EXTENSIONS_DIR || path.join(globalCodeServerRoot, 'extensions'),
    globalUserDir: path.join(globalCodeServerRoot, 'User'),
  };
}

function seedWorkspaceUserData(globalUserDir, userDataDir) {
  const targetUserDir = path.join(userDataDir, 'User');
  const targetSettingsPath = path.join(targetUserDir, 'settings.json');
  if (fs.existsSync(targetSettingsPath)) return;

  ensureDir(targetUserDir);
  copyIfPresent(path.join(globalUserDir, 'settings.json'), path.join(targetUserDir, 'settings.json'));
  copyIfPresent(path.join(globalUserDir, 'keybindings.json'), path.join(targetUserDir, 'keybindings.json'));
  copyIfPresent(path.join(globalUserDir, 'snippets'), path.join(targetUserDir, 'snippets'));
}

function launchCodeServer({
  projectId,
  projectName,
  workspacePath,
  port,
  host = '127.0.0.1',
  proxyBase = '',
  codeServerBin = process.env.CODE_SERVER_BIN || 'code-server',
}) {
  const slug = sanitizeSlug(projectName || projectId || 'workspace');
  const logPath = path.join('/tmp', `code-server-${slug}.log`);
  const runtimeDirs = resolveWorkspaceRuntimeDirs({ projectId, projectName });
  ensureDir(runtimeDirs.userDataDir);
  ensureDir(runtimeDirs.sharedExtensionsDir);
  seedWorkspaceUserData(runtimeDirs.globalUserDir, runtimeDirs.userDataDir);
  const stdout = fs.openSync(logPath, 'a');
  const stderr = fs.openSync(logPath, 'a');
  const env = { ...process.env };
  delete env.VSCODE_IPC_HOOK_CLI;
  delete env.PORT;
  const cookieSuffix = `${projectId || slug}`.replace(/[^a-z0-9_-]+/gi, '-').slice(-32) || slug;
  const normalizedProxyBase = `${proxyBase || ''}`.trim().replace(/\/+$/, '');

  const child = spawn(codeServerBin, [
    '--bind-addr', `${host}:${port}`,
    '--user-data-dir', runtimeDirs.userDataDir,
    '--extensions-dir', runtimeDirs.sharedExtensionsDir,
    '--cookie-suffix', cookieSuffix,
    ...(normalizedProxyBase ? ['--abs-proxy-base-path', normalizedProxyBase] : []),
    '--ignore-last-opened',
    workspacePath,
  ], {
    detached: true,
    stdio: ['ignore', stdout, stderr],
    env,
  });
  child.unref();

  return {
    pid: child.pid,
    logPath,
  };
}

module.exports = {
  findAvailablePort,
  launchCodeServer,
  preferredPortForProject,
  probePort,
  sanitizeSlug,
  waitForPort,
};
