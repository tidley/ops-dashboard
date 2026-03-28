const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');

const CONTROL_CACHE_TTL_MS = Number(process.env.OPENCLAW_CONTROL_CACHE_TTL_MS || 5000);
const execFileAsync = promisify(execFile);

let cachedSnapshot = {
  loadedAt: 0,
  snapshot: null,
};
let refreshPromise = null;

function getOpenClawBin() {
  return process.env.OPENCLAW_BIN || 'openclaw';
}

function buildOpenClawEnv() {
  return {
    ...process.env,
    OPENCLAW_LOG_LEVEL: process.env.OPENCLAW_LOG_LEVEL || 'error',
  };
}

function parseJson(raw, fallback = null) {
  const text = `${raw || ''}`.trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(item => `${item}`.trim()).filter(Boolean);
  }
  if (value == null) return [];
  return `${value}`
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function runOpenClaw(args, options = {}) {
  const command = getOpenClawBin();
  const timeout = Number(options.timeoutMs || 15000);
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      env: buildOpenClawEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    return {
      ok: true,
      stdout: `${stdout || ''}`.trim(),
      stderr: '',
      command,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: `${error.stdout || ''}`.trim(),
      stderr: `${error.stderr || error.message || ''}`.trim(),
      command,
      code: error.code,
    };
  }
}

async function runOpenClawAsync(args, options = {}) {
  const command = getOpenClawBin();
  const timeout = Number(options.timeoutMs || 15000);
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: 'utf8',
      env: buildOpenClawEnv(),
      timeout,
    });
    return {
      ok: true,
      stdout: `${stdout || ''}`.trim(),
      stderr: `${stderr || ''}`.trim(),
      command,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: `${error.stdout || ''}`.trim(),
      stderr: `${error.stderr || error.message || ''}`.trim(),
      command,
      code: error.code,
    };
  }
}

async function runOpenClawJsonAsync(args, options = {}) {
  const result = await runOpenClawAsync(args, options);
  const json = parseJson(result.stdout, null);
  return { ...result, json };
}

function runOpenClawJson(args, options = {}) {
  const result = runOpenClaw(args, options);
  const json = parseJson(result.stdout, null);
  return { ...result, json };
}

function buildOpenClawControlSummary(snapshot) {
  const models = snapshot.models || {};
  const status = snapshot.status || {};
  const gateway = snapshot.gateway || {};
  const summary = {
    bin: snapshot.bin,
    ok: snapshot.ok,
    error: snapshot.error || '',
    modelsStatusOk: typeof snapshot.modelsOk === 'boolean' ? snapshot.modelsOk : true,
    modelsStatusError: snapshot.modelsError || '',
    configPath: models.configPath || gateway?.config?.cli?.path || '',
    defaultModel: models.defaultModel || '',
    resolvedDefault: models.resolvedDefault || '',
    fallbackModels: normalizeList(models.fallbacks),
    imageModel: models.imageModel || '',
    imageFallbacks: normalizeList(models.imageFallbacks),
    allowedModels: normalizeList(models.allowed),
    runtimeVersion: status.runtimeVersion || '',
    sessionCount: Number(status.sessions?.count || 0),
    recentSessionCount: Array.isArray(status.sessions?.recent) ? status.sessions.recent.length : 0,
    channelSummary: Array.isArray(status.channelSummary) ? status.channelSummary : [],
    queuedSystemEvents: Array.isArray(status.queuedSystemEvents) ? status.queuedSystemEvents.length : 0,
    heartbeatAgents: Array.isArray(status.heartbeat?.agents) ? status.heartbeat.agents : [],
    heartbeatDefaultAgentId: status.heartbeat?.defaultAgentId || '',
    gatewayBindMode: gateway.gateway?.bindMode || '',
    gatewayBindHost: gateway.gateway?.bindHost || '',
    gatewayPort: Number(gateway.gateway?.port || 0),
    gatewayPortStatus: gateway.port?.status || '',
    gatewayRpcOk: typeof gateway.rpc?.ok === 'boolean' ? gateway.rpc.ok : null,
    gatewayRpcError: gateway.rpc?.error || '',
    gatewayServiceLoadedText: gateway.service?.loadedText || '',
    gatewayRuntimeStatus: gateway.service?.runtime?.status || '',
    gatewayRuntimeDetail: gateway.service?.runtime?.detail || '',
    gatewayConfigAuditIssues: Array.isArray(gateway.service?.configAudit?.issues) ? gateway.service.configAudit.issues : [],
    authProvidersWithOAuth: Array.isArray(models.auth?.providersWithOAuth) ? models.auth.providersWithOAuth : [],
    authProviders: Array.isArray(models.auth?.providers) ? models.auth.providers : [],
    authProfiles: Array.isArray(models.auth?.profiles) ? models.auth.profiles : [],
    extraServices: Array.isArray(gateway.extraServices) ? gateway.extraServices : [],
  };
  return summary;
}

function buildOpenClawControlPlaceholder() {
  return {
    bin: getOpenClawBin(),
    ok: true,
    loading: true,
    error: '',
    models: null,
    status: null,
    gateway: null,
    actions: {},
    summary: buildOpenClawControlSummary({
      bin: getOpenClawBin(),
      ok: true,
      error: '',
      models: {},
      status: {},
      gateway: {},
    }),
    errors: [],
  };
}

async function buildLiveOpenClawControlPanel() {
  const previousSnapshot = cachedSnapshot.snapshot || null;
  const snapshot = {
    bin: getOpenClawBin(),
    ok: true,
    error: '',
    modelsOk: true,
    modelsError: '',
    models: null,
    status: null,
    gateway: null,
    actions: {},
  };

  const errors = [];
  const [modelsResult, statusResult, gatewayResult] = await Promise.all([
    runOpenClawJsonAsync(['models', 'status', '--json']),
    runOpenClawJsonAsync(['status', '--json']),
    runOpenClawJsonAsync(['gateway', 'status', '--json', '--deep']),
  ]);

  if (modelsResult.json) snapshot.models = modelsResult.json;
  else {
    snapshot.modelsOk = false;
    snapshot.modelsError = modelsResult.stderr || 'openclaw models status failed';
    if (previousSnapshot && previousSnapshot.models) {
      snapshot.models = previousSnapshot.models;
    } else {
      snapshot.models = {
        configPath: '',
        defaultModel: '',
        resolvedDefault: '',
        fallbacks: [],
        imageModel: '',
        imageFallbacks: [],
        allowed: [],
        auth: { providersWithOAuth: [], providers: [], profiles: [] },
      };
    }
  }

  if (statusResult.json) snapshot.status = statusResult.json;
  else {
    snapshot.ok = false;
    errors.push(statusResult.stderr || 'openclaw status failed');
  }

  if (gatewayResult.json) snapshot.gateway = gatewayResult.json;
  else {
    snapshot.ok = false;
    errors.push(gatewayResult.stderr || 'openclaw gateway status failed');
  }

  snapshot.summary = buildOpenClawControlSummary(snapshot);
  snapshot.error = errors[0] || '';
  snapshot.errors = errors;
  if (!snapshot.modelsOk) {
    snapshot.warnings = [
      `${snapshot.modelsError || 'openclaw models status failed'} (using cached model settings if available)`,
    ];
  } else {
    snapshot.warnings = [];
  }

  cachedSnapshot = {
    loadedAt: Date.now(),
    snapshot,
  };
  return snapshot;
}

function collectOpenClawControlPanel({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedSnapshot.snapshot && (now - cachedSnapshot.loadedAt) < CONTROL_CACHE_TTL_MS) {
    return cachedSnapshot.snapshot;
  }
  if (!refreshPromise) {
    refreshPromise = buildLiveOpenClawControlPanel()
      .catch(error => {
        const snapshot = buildOpenClawControlPlaceholder();
        snapshot.ok = false;
        snapshot.loading = false;
        snapshot.error = `${error?.message || error || 'openclaw control refresh failed'}`;
        cachedSnapshot = {
          loadedAt: Date.now(),
          snapshot,
        };
        return snapshot;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return cachedSnapshot.snapshot || buildOpenClawControlPlaceholder();
}

function refreshOpenClawControlPanel({ force = false } = {}) {
  if (refreshPromise && !force) return refreshPromise;
  refreshPromise = buildLiveOpenClawControlPanel()
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function clearOpenClawControlCache() {
  cachedSnapshot = {
    loadedAt: 0,
    snapshot: null,
  };
  refreshPromise = null;
}

function restartOpenClawGateway() {
  const result = runOpenClaw(['gateway', 'restart'], { timeoutMs: 30000 });
  clearOpenClawControlCache();
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || 'openclaw gateway restart failed');
  }
  return result;
}

function setOpenClawDefaultModel(model) {
  const value = `${model || ''}`.trim();
  if (!value) throw new Error('model is required');
  const result = runOpenClaw(['models', 'set', value], { timeoutMs: 30000 });
  clearOpenClawControlCache();
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || 'openclaw models set failed');
  }
  return result;
}

function setOpenClawFallbackModels(fallbacks) {
  const models = normalizeList(fallbacks);
  const clearResult = runOpenClaw(['models', 'fallbacks', 'clear'], { timeoutMs: 30000 });
  if (!clearResult.ok) {
    throw new Error(clearResult.stderr || clearResult.stdout || 'openclaw models fallbacks clear failed');
  }

  for (const model of models) {
    const addResult = runOpenClaw(['models', 'fallbacks', 'add', model], { timeoutMs: 30000 });
    if (!addResult.ok) {
      throw new Error(addResult.stderr || addResult.stdout || `openclaw models fallbacks add failed for ${model}`);
    }
  }

  clearOpenClawControlCache();
  return { ok: true, fallbacks: models };
}

module.exports = {
  buildOpenClawControlSummary,
  buildOpenClawControlPlaceholder,
  clearOpenClawControlCache,
  collectOpenClawControlPanel,
  normalizeList,
  restartOpenClawGateway,
  runOpenClaw,
  runOpenClawJson,
  refreshOpenClawControlPanel,
  setOpenClawDefaultModel,
  setOpenClawFallbackModels,
};
