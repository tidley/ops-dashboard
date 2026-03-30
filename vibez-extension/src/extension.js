const path = require('path');
const vscode = require('vscode');
const { listProjectDirectories, collectGitMetadata } = require('./git');
const {
  buildProjectRecord,
  buildTmuxSessionName,
  groupProjects,
  normalizeProjectPath,
} = require('./model');
const {
  getPendingSwitch,
  getPinnedProjects,
  getProjectState,
  setPendingSwitch,
  togglePinnedProject,
  touchProjectRecent,
  updateProjectState,
} = require('./storage');
const {
  buildAttachCommand,
  ensureTmuxSession,
  hasTmux,
} = require('./tmux');

function expandHomeDir(filePath) {
  const value = String(filePath || '').trim();
  if (!value) return '';
  if (value === '~') return process.env.HOME || value;
  if (value.startsWith('~/')) return path.join(process.env.HOME || '', value.slice(2));
  return value;
}

function getConfiguration() {
  return vscode.workspace.getConfiguration('vibez');
}

function getCurrentWorkspacePath() {
  const folder = Array.isArray(vscode.workspace.workspaceFolders) ? vscode.workspace.workspaceFolders[0] : null;
  return folder ? normalizeProjectPath(folder.uri.fsPath) : '';
}

function getShellPath() {
  return process.env.SHELL || '/bin/bash';
}

class VibezPanel {
  constructor(extensionUri, onMessage) {
    this.extensionUri = extensionUri;
    this.onMessage = onMessage;
    this.panel = null;
  }

  show() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return this.panel;
    }

    this.panel = vscode.window.createWebviewPanel(
      'vibez.browser',
      'Vibez',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      },
    );

    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.panel.webview.onDidReceiveMessage((message) => {
      this.onMessage(message || {});
    });

    return this.panel;
  }

  async postState(state) {
    if (!this.panel) return;
    await this.panel.webview.postMessage({
      type: 'state',
      payload: state,
    });
  }

  renderHtml(webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vibez</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="app" class="app">
    <div class="loading">Loading Vibez…</div>
  </div>
  <script nonce="${nonce}">
    window.VIBEZ_API = acquireVsCodeApi();
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

class VibezController {
  constructor(context) {
    this.context = context;
    this.panel = new VibezPanel(context.extensionUri, (message) => this.handleMessage(message));
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBarItem.text = '$(repo) Vibez';
    this.statusBarItem.command = 'vibez.open';
    this.statusBarItem.tooltip = 'Open Vibez project browser';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);
  }

  async activate() {
    await this.restorePendingProjectTerminal();
  }

  async resolveCodeDirectory() {
    const configured = expandHomeDir(getConfiguration().get('codeDirectory', '~/code'));
    return normalizeProjectPath(configured);
  }

  async loadProjects() {
    const codeDirectory = await this.resolveCodeDirectory();
    const currentWorkspacePath = getCurrentWorkspacePath();
    const pinnedProjects = getPinnedProjects(this.context);
    const projectPaths = await listProjectDirectories(codeDirectory);

    const projects = await Promise.all(projectPaths.map(async (projectPath) => {
      const [git, metadata] = await Promise.all([
        collectGitMetadata(projectPath),
        Promise.resolve(getProjectState(this.context, projectPath)),
      ]);

      return buildProjectRecord({
        projectPath,
        rootPath: codeDirectory,
        metadata: {
          ...metadata,
          tmuxSessionName: metadata.tmuxSessionName || buildTmuxSessionName(projectPath, getConfiguration().get('tmux.sessionPrefix', 'vibez')),
        },
        git,
        pinned: pinnedProjects.has(normalizeProjectPath(projectPath)),
        currentWorkspacePath,
      });
    }));

    const grouped = groupProjects(projects, {
      recentLimit: getConfiguration().get('recentLimit', 8),
    });

    return {
      codeDirectory,
      hasCodeDirectory: Boolean(codeDirectory),
      currentWorkspacePath,
      tmuxEnabled: Boolean(getConfiguration().get('tmux.enabled', true)),
      reuseWindow: Boolean(getConfiguration().get('switch.reuseWindow', true)),
      restoreTerminal: Boolean(getConfiguration().get('switch.restoreTerminal', true)),
      bootstrapCommand: String(getConfiguration().get('tmux.bootstrapCommand', 'codex') || ''),
      groups: grouped,
      projectCount: projects.length,
      pinnedCount: grouped.pinned.length,
      recentCount: grouped.recents.length,
    };
  }

  async refreshPanel() {
    const state = await this.loadProjects();
    await this.panel.postState(state);
  }

  async openPanel() {
    this.panel.show();
    await this.refreshPanel();
  }

  async pickCodeDirectory() {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use as Vibez code directory',
      defaultUri: vscode.Uri.file(await this.resolveCodeDirectory()),
    });

    if (!selection || !selection.length) return;
    await getConfiguration().update('codeDirectory', selection[0].fsPath, vscode.ConfigurationTarget.Global);
    await this.refreshPanel();
  }

  async pickProjectQuick() {
    const state = await this.loadProjects();
    const ordered = [
      ...state.groups.pinned,
      ...state.groups.recents.filter(project => !state.groups.pinned.some(pinned => pinned.id === project.id)),
      ...state.groups.others,
    ];

    if (!ordered.length) {
      vscode.window.showInformationMessage('Vibez found no projects in the configured code directory.');
      return;
    }

    const selection = await vscode.window.showQuickPick(ordered.map((project) => ({
      label: project.name,
      description: project.branch ? `${project.branch} • ${project.relativePath}` : project.relativePath,
      detail: project.lastCommitSubject || project.path,
      project,
    })), {
      title: 'Switch Project',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selection) return;
    await this.switchProject(selection.project.path);
  }

  async ensureProjectTmux(projectPath) {
    if (!getConfiguration().get('tmux.enabled', true)) {
      return { ok: true, tmuxSessionName: '' };
    }

    const available = await hasTmux();
    if (!available) {
      return { ok: false, error: 'tmux is not available on PATH' };
    }

    const prefix = getConfiguration().get('tmux.sessionPrefix', 'vibez');
    const bootstrapCommand = String(getConfiguration().get('tmux.bootstrapCommand', 'codex') || '');
    const tmuxSessionName = buildTmuxSessionName(projectPath, prefix);
    const ensured = await ensureTmuxSession({
      projectPath,
      sessionName: tmuxSessionName,
      bootstrapCommand,
    });

    if (!ensured.ok) return ensured;

    await updateProjectState(this.context, projectPath, {
      tmuxSessionName,
    });

    return { ok: true, tmuxSessionName };
  }

  attachProjectTerminal(projectPath, tmuxSessionName) {
    const sessionName = tmuxSessionName || buildTmuxSessionName(projectPath, getConfiguration().get('tmux.sessionPrefix', 'vibez'));
    const command = buildAttachCommand({ projectPath, sessionName });
    const terminal = vscode.window.createTerminal({
      name: `Vibez · ${path.basename(projectPath)}`,
      cwd: projectPath,
      shellPath: getShellPath(),
      shellArgs: ['-lc', command],
    });
    terminal.show(true);
    return sessionName;
  }

  async switchProject(projectPath, options = {}) {
    const resolvedPath = normalizeProjectPath(projectPath);
    const reuseWindow = options.reuseWindow !== undefined
      ? Boolean(options.reuseWindow)
      : Boolean(getConfiguration().get('switch.reuseWindow', true));
    const restoreTerminal = options.restoreTerminal !== undefined
      ? Boolean(options.restoreTerminal)
      : Boolean(getConfiguration().get('switch.restoreTerminal', true));

    const tmuxState = await this.ensureProjectTmux(resolvedPath);
    if (!tmuxState.ok) {
      vscode.window.showWarningMessage(`Vibez could not prepare tmux for ${path.basename(resolvedPath)}: ${tmuxState.error}`);
    }

    const recentState = await touchProjectRecent(this.context, resolvedPath, {
      tmuxSessionName: tmuxState.tmuxSessionName || '',
    });

    await setPendingSwitch(this.context, {
      projectPath: resolvedPath,
      requestedAt: new Date().toISOString(),
      restoreTerminal,
      tmuxSessionName: tmuxState.tmuxSessionName || recentState.tmuxSessionName || '',
    });

    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(resolvedPath), !reuseWindow);
  }

  async restorePendingProjectTerminal() {
    const pending = getPendingSwitch(this.context);
    if (!pending || !pending.projectPath) return;

    const currentWorkspacePath = getCurrentWorkspacePath();
    if (!currentWorkspacePath || normalizeProjectPath(pending.projectPath) !== currentWorkspacePath) return;

    await setPendingSwitch(this.context, null);

    if (!pending.restoreTerminal || !getConfiguration().get('tmux.enabled', true)) return;

    const ageMs = Date.now() - new Date(pending.requestedAt || 0).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return;

    const tmuxSessionName = pending.tmuxSessionName || buildTmuxSessionName(currentWorkspacePath, getConfiguration().get('tmux.sessionPrefix', 'vibez'));
    this.attachProjectTerminal(currentWorkspacePath, tmuxSessionName);
    await updateProjectState(this.context, currentWorkspacePath, {
      tmuxSessionName,
      tmuxAttachedAt: new Date().toISOString(),
    });
  }

  async handleMessage(message) {
    const type = String(message?.type || '');
    if (type === 'ready' || type === 'refresh') {
      await this.refreshPanel();
      return;
    }
    if (type === 'pickCodeDirectory') {
      await this.pickCodeDirectory();
      return;
    }
    if (type === 'togglePin') {
      await togglePinnedProject(this.context, message.projectPath);
      await this.refreshPanel();
      return;
    }
    if (type === 'switchProject') {
      await this.switchProject(message.projectPath, {
        reuseWindow: message.reuseWindow,
        restoreTerminal: message.restoreTerminal,
      });
      return;
    }
    if (type === 'attachProjectTerminal') {
      const tmuxState = await this.ensureProjectTmux(message.projectPath);
      if (!tmuxState.ok) {
        vscode.window.showErrorMessage(`Vibez could not attach terminal: ${tmuxState.error}`);
        return;
      }
      this.attachProjectTerminal(message.projectPath, tmuxState.tmuxSessionName);
      await updateProjectState(this.context, message.projectPath, {
        tmuxSessionName: tmuxState.tmuxSessionName,
        tmuxAttachedAt: new Date().toISOString(),
      });
      await this.refreshPanel();
    }
  }
}

function activate(context) {
  const controller = new VibezController(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('vibez.open', () => controller.openPanel()),
    vscode.commands.registerCommand('vibez.pickProject', () => controller.pickProjectQuick()),
    vscode.commands.registerCommand('vibez.pickCodeDirectory', () => controller.pickCodeDirectory()),
    vscode.commands.registerCommand('vibez.attachProjectTerminal', async () => {
      const currentWorkspacePath = getCurrentWorkspacePath();
      if (!currentWorkspacePath) {
        vscode.window.showInformationMessage('Open a project workspace before attaching a Vibez terminal.');
        return;
      }
      const tmuxState = await controller.ensureProjectTmux(currentWorkspacePath);
      if (!tmuxState.ok) {
        vscode.window.showErrorMessage(`Vibez could not prepare tmux: ${tmuxState.error}`);
        return;
      }
      controller.attachProjectTerminal(currentWorkspacePath, tmuxState.tmuxSessionName);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('vibez')) return;
      await controller.refreshPanel();
    }),
  );

  controller.activate();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
