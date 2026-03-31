# Vibez

Vibez is a VS Code-first project switcher built to feel closer to Git Graph than a dashboard.

It provides:

- A compact project browser with pinned, recent, and all-project sections.
- A configurable `code` root directory for discovery.
- One-click project switching through `vscode.openFolder`.
- tmux-backed terminal/session restore so long-running `codex` sessions survive workspace switches.
- Multi-window mode so project windows stay warm for faster switching.
- Persisted per-project metadata such as pins, recents, and terminal session names.

## How it works

1. Set `Vibez: Code Directory` to the folder containing your repositories.
2. Open `Vibez: Open Project Browser`.
3. Click `Switch` on a project row.
4. Vibez switches to the project using either a single-window or multi-window flow, then reattaches the matching tmux session if enabled.

`vibez.windowMode` defaults to `single-window`. In that mode, Vibez reuses the current VS Code window when switching projects. If you switch it to `multi-window`, Vibez keeps the current project window open, launches cold projects in a new VS Code window, and uses the VS Code CLI to reactivate already-open projects when possible.

When `vibez.tmux.bootstrapCommand` is left at the default `codex`, newly created project sessions start with `codex` automatically. Existing tmux sessions are reused as-is, which preserves the terminal conversation already running there.

## Build

Vibez is a plain JavaScript extension, so there is no separate compile step.

Lint the extension sources:

```bash
cd /home/tom/code/ops-dashboard/vibez-extension
npm run lint
```

Package a `.vsix`:

```bash
cd /home/tom/code/ops-dashboard/vibez-extension
npm install -g @vscode/vsce
vsce package
```

That produces a file like `vibez-0.0.1.vsix` in the extension directory.

Install the packaged extension:

```bash
code --install-extension /home/tom/code/ops-dashboard/vibez-extension/vibez-0.0.1.vsix
```

For iterative development, you can also open the extension folder in VS Code and run the extension host from `Run and Debug`.

## Notes

- tmux is optional but strongly recommended if you want terminal-level continuity.
- Vibez does not scrape another extension's internal conversation history. Continuity comes from persistent tmux sessions and Vibez's own per-project metadata.
