const { execFile } = require('child_process');

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

async function hasTmux() {
  const result = await execFileAsync('tmux', ['-V']);
  return result.ok;
}

function parseTmuxSessionNames(rawValue) {
  return new Set(
    String(rawValue || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

async function listTmuxSessions() {
  const result = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
  if (result.ok) {
    return { ok: true, sessions: parseTmuxSessionNames(result.stdout) };
  }

  const errorText = `${result.stderr}\n${result.error?.message || ''}`.toLowerCase();
  if (errorText.includes('no server running') || errorText.includes('failed to connect to server')) {
    return { ok: true, sessions: new Set() };
  }

  return {
    ok: false,
    error: result.stderr.trim() || result.error?.message || 'Unable to list tmux sessions',
    sessions: new Set(),
  };
}

async function ensureTmuxSession({ projectPath, sessionName, bootstrapCommand = '' }) {
  const sessionCheck = await execFileAsync('tmux', ['has-session', '-t', sessionName]);
  if (sessionCheck.ok) {
    return { ok: true, created: false };
  }

  const created = await execFileAsync('tmux', ['new-session', '-d', '-s', sessionName, '-c', projectPath]);
  if (!created.ok) {
    return {
      ok: false,
      created: false,
      error: created.stderr.trim() || created.error?.message || 'Unable to create tmux session',
    };
  }

  const command = String(bootstrapCommand || '').trim();
  if (command) {
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, command, 'C-m']);
  }

  return { ok: true, created: true };
}

function buildAttachCommand({ projectPath, sessionName }) {
  return `tmux new-session -A -s ${shellQuote(sessionName)} -c ${shellQuote(projectPath)}`;
}

module.exports = {
  buildAttachCommand,
  ensureTmuxSession,
  hasTmux,
  listTmuxSessions,
  parseTmuxSessionNames,
};
