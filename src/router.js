const { v4: uuid } = require('uuid');
const { execFile } = require('node:child_process');

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return fallback;
  }
}

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function buildOpenClawEnv(envelope) {
  const env = {
    HOME: process.env.HOME || '',
    PATH: process.env.PATH || '',
    USER: process.env.USER || '',
    SHELL: process.env.SHELL || '',
    LANG: process.env.LANG || '',
    LC_ALL: process.env.LC_ALL || '',
    LC_CTYPE: process.env.LC_CTYPE || '',
    TERM: process.env.TERM || '',
    OPENCLAW_PROJECT_ID: envelope.project_id || '',
    OPENCLAW_SESSION_ID: envelope.agent_session_id || envelope.session_id || '',
  };

  if (process.env.OPENCLAW_BIN) env.OPENCLAW_BIN = process.env.OPENCLAW_BIN;
  if (process.env.NVM_BIN) env.NVM_BIN = process.env.NVM_BIN;
  if (process.env.NVM_DIR) env.NVM_DIR = process.env.NVM_DIR;
  if (process.env.NVM_INC) env.NVM_INC = process.env.NVM_INC;
  if (process.env.OPENCLAW_LOG_LEVEL) env.OPENCLAW_LOG_LEVEL = process.env.OPENCLAW_LOG_LEVEL;

  return env;
}

function stripOpenClawNoise(text) {
  const lines = `${text || ''}`.split(/\r?\n/);
  const filtered = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\[plugins\]\s/.test(trimmed)) continue;
    if (/^\[tools\]\s/.test(trimmed)) continue;
    if (/^\[diagnostic\]\s/.test(trimmed)) continue;
    if (/^\[model-fallback\/decision\]\s/.test(trimmed)) continue;
    if (/^\(node:\d+\)\s+\[OPENCLAW_/.test(trimmed)) continue;
    if (/^Warning:\s/.test(trimmed)) continue;
    if (/^Use `?node --trace-warnings`?/i.test(trimmed)) continue;
    if (/OPENCLAW_PLUGIN_SDK_COMPAT_DEPRECATED/.test(trimmed)) continue;
    if (/^Bundled plugins must use scoped plugin-sdk subpaths\./i.test(trimmed)) continue;
    if (/^External plugins may keep compat temporarily while migrating\./i.test(trimmed)) continue;
    if (/^Migration guide:\s*https:\/\/docs\.openclaw\.ai\/plugins\/sdk-migration/i.test(trimmed)) continue;
    filtered.push(line);
  }

  return filtered.join('\n').trim();
}

function extractTrailingJson(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  const candidates = [
    trimmed,
    trimmed.slice(trimmed.lastIndexOf('\n{') + 1),
    trimmed.slice(trimmed.lastIndexOf('{')),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = parseJson(candidate, null);
    if (parsed && typeof parsed === 'object') return candidate;
  }

  return '';
}

function clampPromptText(text, maxChars = 12000) {
  const value = `${text || ''}`;
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 12000;
  if (value.length <= limit) return value;

  const note = '\n\n## Truncated context\nSome context was omitted to stay within CLI argument limits.';
  const cut = Math.max(0, limit - note.length);
  return `${value.slice(0, cut).replace(/\s+$/, '')}${note}`;
}

function extractTextFromResponses(json) {
  if (typeof json?.output_text === 'string' && json.output_text.trim()) {
    return json.output_text.trim();
  }

  const parts = [];
  for (const item of Array.isArray(json?.output) ? json.output : []) {
    if (typeof item?.text === 'string' && item.text.trim()) {
      parts.push(item.text.trim());
      continue;
    }

    for (const block of Array.isArray(item?.content) ? item.content : []) {
      if (typeof block?.text === 'string' && block.text.trim()) {
        parts.push(block.text.trim());
      }
    }
  }

  if (parts.length) return parts.join('\n').trim();
  if (typeof json?.reply === 'string' && json.reply.trim()) return json.reply.trim();
  return '';
}

function extractTextFromOpenClawResponse(json) {
  if (!json || typeof json !== 'object') return '';
  if (typeof json.reply === 'string' && json.reply.trim()) return json.reply.trim();
  if (typeof json.output === 'string' && json.output.trim()) return json.output.trim();

  const payloads = Array.isArray(json.payloads) ? json.payloads : [];
  const texts = payloads
    .map((p) => (typeof p?.text === 'string' ? p.text.trim() : ''))
    .filter(Boolean);
  if (texts.length) return texts.join('\n\n');

  if (typeof json.text === 'string' && json.text.trim()) return json.text.trim();
  return '';
}

function normalizeOpenClawResponse(raw, maybeJson) {
  const extracted = extractTextFromOpenClawResponse(maybeJson);
  if (extracted) {
    return {
      status: 'ok',
      output: extracted,
      error: '',
    };
  }

  const trimmed = `${raw || ''}`.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
    return {
      status: 'error',
      output: '(no reply)',
      error: 'OpenClaw returned no textual reply',
    };
  }

  if (typeof maybeJson === 'object' && maybeJson !== null) {
    return {
      status: 'ok',
      output: JSON.stringify(maybeJson),
      error: '',
    };
  }

  return {
    status: 'ok',
    output: trimmed,
    error: '',
  };
}

function stringifyPromptSection(title, value) {
  if (!value) return '';
  return `## ${title}\n${value}\n`;
}

function summarizePlanningList(items = [], limit = 3) {
  return items.slice(0, limit).map(item => {
    const bullets = (item.bullets || []).slice(0, 3).map(bullet => `- ${bullet}`).join('\n');
    return `### ${item.title}\n${bullets || '- (no bullets)'}`;
  }).join('\n\n');
}

function summarizeConversationHistory(messages = [], limit = 12) {
  return messages.slice(-limit).map(message => {
    const role = message.direction === 'outbound'
      ? 'User'
      : (message.agent_id || message.message_type || 'Agent');
    const createdAt = message.created_at ? ` @ ${message.created_at}` : '';
    const content = `${message.content || ''}`.trim() || '(empty)';
    return `- ${role}${createdAt}: ${content}`;
  }).join('\n');
}

function summarizeMemoryState(memory = {}) {
  const lines = [];
  if (memory.summary) lines.push(`Summary: ${memory.summary}`);
  if (memory.last_user_message) lines.push(`Last user message: ${memory.last_user_message}`);
  if (memory.last_reply) lines.push(`Last reply: ${memory.last_reply}`);
  if (memory.last_bootstrapped_at) lines.push(`Bootstrapped at: ${memory.last_bootstrapped_at}`);
  if (memory.project_root) lines.push(`Project root: ${memory.project_root}`);
  return lines.join('\n');
}

function summarizeProjectMemory(projectMemory = {}) {
  const sections = [];
  const state = projectMemory.state || {};
  const recentSessions = Array.isArray(projectMemory.recentSessions) ? projectMemory.recentSessions : [];
  const recentWorkflows = Array.isArray(projectMemory.recentWorkflows) ? projectMemory.recentWorkflows : [];
  const recentLogs = Array.isArray(projectMemory.recentLogs) ? projectMemory.recentLogs : [];
  const recentArtifacts = Array.isArray(projectMemory.recentArtifacts) ? projectMemory.recentArtifacts : [];

  if (Object.keys(state).length) {
    sections.push([
      `State session id: ${state.openclaw_session_id || '(none)'}`,
      `Last tab: ${state.last_tab || '(none)'}`,
      `Last opened at: ${state.last_opened_at || '(none)'}`,
      `Last project session: ${state.last_session_id || '(none)'}`,
      `Memory namespace: ${projectMemory.memoryNamespace || '(none)'}`,
      `Workspace: ${projectMemory.workspaceDir || '(none)'}`,
    ].join('\n'));
  }

  if (recentSessions.length) {
    sections.push(`Recent sessions:\n${recentSessions.slice(0, 5).map(session => `- ${session.id} | ${session.title} | ${session.state}`).join('\n')}`);
  }

  if (recentWorkflows.length) {
    sections.push(`Recent workflows:\n${recentWorkflows.slice(0, 5).map(workflow => `- ${workflow.id} | ${workflow.name} | ${workflow.state}`).join('\n')}`);
  }

  if (recentLogs.length) {
    sections.push(`Recent logs:\n${recentLogs.slice(0, 5).map(log => `- ${log.level} | ${log.event_type} | ${log.message}`).join('\n')}`);
  }

  if (recentArtifacts.length) {
    sections.push(`Recent artifacts:\n${recentArtifacts.slice(0, 5).map(artifact => `- ${artifact.name} | ${artifact.file_path}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

function summarizePlanningDocs(docs = []) {
  return (Array.isArray(docs) ? docs : []).map(doc => {
    const scope = `${doc?.scope || 'planning'}`.trim();
    const text = clampPromptText(`${doc?.text || ''}`.trim(), 1200);
    if (!text) return '';
    return `## [${scope}]\n${text}`;
  }).filter(Boolean).join('\n\n');
}

function summarizeProjectConfiguration(project = {}) {
  const settings = project?.settings_json || {};
  const codeFolder = `${settings.code_folder || settings.imported_from || project?.workspace_dir || ''}`.trim();
  const subfolders = Array.isArray(settings.subfolders) ? settings.subfolders : [];
  const ignoreFolders = Array.isArray(settings.ignore_folders) ? settings.ignore_folders : [];
  const instructions = `${settings.getting_started || settings.instructions || ''}`.trim();
  const backendOverride = `${settings.backend_override || settings.backendOverride || 'inherit'}`.trim() || 'inherit';
  const routstrProvider = `${settings.routstr_provider || settings.routstrProvider || ''}`.trim();
  const routstrModel = `${settings.routstr_model || settings.routstrModel || ''}`.trim();
  const lines = [
    `Main code folder: ${codeFolder || '(not set)'}`,
    `Subfolders: ${subfolders.length ? subfolders.join(', ') : '(all files under the code folder)'}`,
    `Ignored folders: ${ignoreFolders.length ? ignoreFolders.join(', ') : '(none)'}`,
    `Backend override: ${backendOverride}`,
  ];
  if (routstrProvider || routstrModel) {
    lines.push(`Routstr: ${routstrProvider || '(provider unset)'} / ${routstrModel || '(model unset)'}`);
  }
  if (instructions) lines.push(`Instructions: ${instructions}`);
  return lines.join('\n');
}

function buildCodexPrompt({ project, envelope, planning, config = {} }) {
  const payloadText = envelope.payload?.text || envelope.payload?.prompt || envelope.payload?.task || '';
  const payloadJson = JSON.stringify(envelope.payload || {}, null, 2);
  const promptSections = [
    'You are Codex embedded in the Ops Dashboard.',
    'Use the repository and planning context to answer concretely.',
    'Prefer actionable code changes, exact file paths, and concise next steps.',
    '',
    stringifyPromptSection('Project', [
      `Name: ${project?.name || 'unknown'}`,
      `Description: ${project?.description || ''}`,
      `Workspace: ${project?.workspace_dir || ''}`,
      `Memory namespace: ${project?.memory_namespace || ''}`,
      `Tags: ${(project?.tags || []).join(', ') || '(none)'}`,
      `Active workflows: ${(project?.workflows || []).map(w => `${w.name} (${w.state})`).join(', ') || '(none)'}`,
      `Active sessions: ${(project?.sessions || []).map(s => `${s.title} (${s.state})`).join(', ') || '(none)'}`,
    ].join('\n')),
    stringifyPromptSection('Project configuration', summarizeProjectConfiguration(project)),
    planning?.objective ? stringifyPromptSection('Objective', planning.objective) : '',
    planning?.now?.length ? stringifyPromptSection('Now', summarizePlanningList(planning.now, 3)) : '',
    planning?.next?.length ? stringifyPromptSection('Next', summarizePlanningList(planning.next, 2)) : '',
    planning?.risks?.length ? stringifyPromptSection('Risks', summarizePlanningList(planning.risks, 2)) : '',
    planning?.todo?.length ? stringifyPromptSection('Todo', summarizePlanningDocs(planning.todo)) : '',
    planning?.context?.length ? stringifyPromptSection('Context', summarizePlanningDocs(planning.context)) : '',
    stringifyPromptSection('User request', payloadText || '(no text provided)'),
    stringifyPromptSection('Envelope', payloadJson),
  ].filter(Boolean);

  if (config.prompt_prefix) {
    promptSections.unshift(String(config.prompt_prefix).trim());
  }
  if (config.prompt_suffix) {
    promptSections.push(String(config.prompt_suffix).trim());
  }

  return promptSections.join('\n');
}

function buildOpenClawPrompt({ agent, envelope, project, projectState, planning, conversationHistory = [], projectMemory = null, config = {} }) {
  const payloadText = envelope.payload?.text || envelope.payload?.prompt || envelope.payload?.task || '';
  const projectRoot = project?.settings_json?.imported_from || project?.workspace_dir || '';
  const memory = parseJson(projectState?.openclaw_memory_json || {}, {});
  const activeWorkflows = (project?.workflows || []).slice(0, 3).map(w => `${w.name} (${w.state})`).join(', ');
  const activeSessions = (project?.sessions || []).slice(0, 3).map(s => `${s.title} (${s.state})`).join(', ');
  const historyText = summarizeConversationHistory(conversationHistory, 12);
  const memoryText = summarizeMemoryState(memory);
  const projectMemoryText = summarizeProjectMemory(projectMemory || {});
  const playbookGuidance = planning?.playbook ? [
    planning.playbook.bootstrapGuidelines ? `### Project bootstrap guidelines\n${planning.playbook.bootstrapGuidelines.trim()}` : '',
    planning.playbook.tddLoop ? `### TDD loop\n${planning.playbook.tddLoop.trim()}` : '',
    planning.playbook.reliabilityReview ? `### Reliability review\n${planning.playbook.reliabilityReview.trim()}` : '',
  ].filter(Boolean).join('\n\n') : '';
  const promptSections = [
    'Read OPENCLAW_BOOTSTRAP.md in the repository root before responding.',
    '',
    stringifyPromptSection('Agent', [
      `Name: ${agent?.name || 'OpenClaw'}`,
      `Role: ${agent?.role || ''}`,
      `Kind: ${agent?.kind || 'openclaw'}`,
      `Agent id: ${agent?.id || '(none)'}`,
    ].join('\n')),
    stringifyPromptSection('Project', [
      `Name: ${project?.name || 'unknown'}`,
      `Description: ${project?.description || ''}`,
      `Workspace: ${projectRoot}`,
      `Tags: ${(project?.tags || []).join(', ') || '(none)'}`,
      `Workflows: ${activeWorkflows || '(none)'}`,
      `Sessions: ${activeSessions || '(none)'}`,
    ].join('\n')),
    stringifyPromptSection('Project configuration', summarizeProjectConfiguration(project)),
    stringifyPromptSection('User request', payloadText || '(no text provided)'),
    stringifyPromptSection('Project agent', [
      `Session id: ${envelope.agent_session_id || projectState?.openclaw_session_id || '(new)'}`,
      `Last bootstrapped: ${projectState?.openclaw_bootstrapped_at || '(never)'}`,
      `Last seen: ${projectState?.openclaw_last_seen_at || '(never)'}`,
      `Memory namespace: ${project?.memory_namespace || '(none)'}`,
      memoryText || '',
    ].filter(Boolean).join('\n')),
    historyText ? stringifyPromptSection('Conversation history', historyText) : '',
    planning?.objective ? stringifyPromptSection('Objective', planning.objective) : '',
    planning?.currentState?.length ? stringifyPromptSection('Current state', planning.currentState.map(line => `- ${line}`).join('\n')) : '',
    planning?.now?.length ? stringifyPromptSection('Now', summarizePlanningList(planning.now, 3)) : '',
    planning?.next?.length ? stringifyPromptSection('Next', summarizePlanningList(planning.next, 3)) : '',
    planning?.backlog?.length ? stringifyPromptSection('Backlog', summarizePlanningList(planning.backlog, 2)) : '',
    planning?.risks?.length ? stringifyPromptSection('Risks', summarizePlanningList(planning.risks, 2)) : '',
    planning?.todo?.length ? stringifyPromptSection('Todo', summarizePlanningDocs(planning.todo)) : '',
    planning?.decisions?.length ? stringifyPromptSection('Decisions', summarizePlanningDocs(planning.decisions)) : '',
    planning?.context?.length ? stringifyPromptSection('Context', summarizePlanningDocs(planning.context)) : '',
    stringifyPromptSection('Session', [
      `Project session id: ${envelope.session_id || '(none)'}`,
      `Workflow id: ${envelope.workflow_id || '(none)'}`,
      `Message type: ${envelope.message_type || 'prompt'}`,
      `Priority: ${envelope.priority || 'normal'}`,
    ].join('\n')),
    projectMemoryText ? stringifyPromptSection('Project memory', projectMemoryText) : '',
    playbookGuidance ? stringifyPromptSection('Operating procedures', playbookGuidance) : '',
  ].filter(Boolean);

  if (config.prompt_prefix) {
    promptSections.unshift(String(config.prompt_prefix).trim());
  }
  if (config.prompt_suffix) {
    promptSections.push(String(config.prompt_suffix).trim());
  }

  const maxPromptChars = Number(config.max_prompt_chars || process.env.OPENCLAW_MAX_PROMPT_CHARS || 12000);
  return clampPromptText(promptSections.join('\n'), maxPromptChars);
}

async function callOpenAIResponses({ apiKey, model, prompt, reasoningEffort = 'medium', maxOutputTokens = 1200 }) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: maxOutputTokens,
      store: false,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      status: 'error',
      output: '',
      error: json?.error?.message || `HTTP ${res.status}`,
      toolOutput: json,
    };
  }

  const output = extractTextFromResponses(json);
  return {
    status: 'ok',
    output: output || JSON.stringify(json),
    toolOutput: json,
  };
}

async function routeToCodex({ agent, envelope, project, planning }) {
  const cfg = parseJson(agent?.config_json, {});
  const apiKey = cfg.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      status: 'error',
      output: '',
      error: 'OPENAI_API_KEY is required for codex routing',
      toolOutput: { knownKinds: ['codex'], requestId: uuid() },
    };
  }

  const model = cfg.model || process.env.CODEX_MODEL || 'gpt-5.3-codex';
  const reasoningEffort = cfg.reasoning_effort || process.env.CODEX_REASONING_EFFORT || 'medium';
  const maxOutputTokens = Number(cfg.max_output_tokens || process.env.CODEX_MAX_OUTPUT_TOKENS || 1200);
  const prompt = buildCodexPrompt({ project, envelope, planning, config: cfg });

  return callOpenAIResponses({
    apiKey,
    model,
    prompt,
    reasoningEffort,
    maxOutputTokens: Number.isFinite(maxOutputTokens) ? maxOutputTokens : 1200,
  });
}

async function routeToOpenClaw({ agent, envelope, project = null, projectState = null, planning = null, conversationHistory = [], projectMemory = null }) {
  const cfg = parseJson(agent?.config_json, {});
  const command = cfg.command || process.env.OPENCLAW_BIN || 'openclaw';
  const timeoutSec = Number(cfg.timeout_sec || 60);
  const logLevel = String(cfg.log_level || process.env.OPENCLAW_LOG_LEVEL || 'error').trim() || 'error';
  const baseSessionId = envelope.agent_session_id
    || `opsdash:${project?.id || envelope.project_id || 'project'}:${envelope.session_id || 'session'}:openclaw`;
  const sessionId = cfg.session_id_prefix
    ? `${cfg.session_id_prefix}${baseSessionId}`
    : baseSessionId;

  const text = buildOpenClawPrompt({ agent, envelope, project, projectState, planning, conversationHistory, projectMemory, config: cfg });

  const args = [
    '--log-level', logLevel,
    'agent',
    '--json',
    '--session-id', sessionId,
    '--message', text,
    '--timeout', String(Number.isFinite(timeoutSec) ? timeoutSec : 60),
  ];

  if (cfg.agent_id) args.push('--agent', cfg.agent_id);
  if (cfg.thinking) args.push('--thinking', cfg.thinking);
  // Default to local mode to avoid gateway connectivity issues
  if (cfg.local !== false) args.push('--local');

  const proc = await execFileAsync(command, args, {
    timeout: (Number.isFinite(timeoutSec) ? timeoutSec : 90) * 1000 + 5000,
    maxBuffer: 1024 * 1024 * 16,
    cwd: cfg.cwd || project?.settings_json?.imported_from || process.cwd(),
    env: buildOpenClawEnv(envelope),
  });

  const rawStdout = `${proc.stdout}`.trim();
  const rawStderr = `${proc.stderr}`.trim();
  const raw = rawStdout || stripOpenClawNoise(rawStderr);
  const jsonText = extractTrailingJson(rawStdout) || extractTrailingJson(rawStderr) || raw;
  const maybeJson = parseJson(jsonText, null);

  if (proc.error) {
    const missingBinary = proc.error.code === 'ENOENT';
    const errorMessage = missingBinary
      ? `OpenClaw binary not found: ${command}. Set OPENCLAW_BIN to the executable path or add it to PATH.`
      : `${proc.stderr || proc.error.message || 'openclaw command failed'}`.trim();
    return {
      status: 'error',
      output: maybeJson?.reply || errorMessage,
      error: errorMessage,
      toolOutput: {
        adapter: 'openclaw',
        command: [command, ...args],
        stdout: rawStdout,
        stderr: rawStderr,
        code: proc.error.code || '',
      },
    };
  }

  const normalized = normalizeOpenClawResponse(raw, maybeJson);

  return {
    status: normalized.status,
    output: normalized.output,
    error: normalized.error,
    toolOutput: {
      adapter: 'openclaw',
      response: maybeJson || raw,
      command: [command, ...args],
      stdout: rawStdout,
      stderr: rawStderr,
    },
  };
}

async function routeToAgent({ agent, envelope, project = null, projectState = null, planning = null, conversationHistory = [], projectMemory = null, agentBackendSettings = null }) {
  if (!agent || agent.kind === 'echo') {
    return {
      status: 'ok',
      output: `Echo(${envelope.agent_id || 'none'}): ${envelope.payload?.text || envelope.payload?.prompt || 'No text payload'}`,
      toolOutput: { adapter: 'echo' }
    };
  }

  const effectiveBackend = `${agentBackendSettings?.effectiveBackend || ''}`.trim().toLowerCase();
  if (effectiveBackend === 'direct-codex') {
    return routeToCodex({ agent, envelope, project, planning });
  }

  if (agent.kind === 'http') {
    const cfg = parseJson(agent.config_json, {});
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {})
      },
      body: JSON.stringify(envelope)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: 'error', output: '', error: json.error || `HTTP ${res.status}`, toolOutput: json };
    }

    return {
      status: 'ok',
      output: json.reply || json.output || JSON.stringify(json),
      toolOutput: json
    };
  }

  if (agent.kind === 'codex') {
    return routeToCodex({ agent, envelope, project, planning });
  }

  if (agent.kind === 'openclaw') {
    return routeToOpenClaw({ agent, envelope, project, projectState, planning, conversationHistory, projectMemory });
  }

  return {
    status: 'error',
    output: '',
    error: `Unsupported agent kind: ${agent.kind}`,
    toolOutput: { knownKinds: ['echo', 'http', 'codex', 'openclaw'], requestId: uuid() }
  };
}

module.exports = { routeToAgent, routeToCodex, buildCodexPrompt, routeToOpenClaw, extractTextFromOpenClawResponse, normalizeOpenClawResponse, buildOpenClawPrompt, summarizeConversationHistory, summarizeMemoryState, summarizeProjectMemory, clampPromptText };
