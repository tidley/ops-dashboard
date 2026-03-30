# Vibez

Vibez is a VS Code-first project switcher built to feel closer to Git Graph than a dashboard.

It provides:

- A compact project browser with pinned, recent, and all-project sections.
- A configurable `code` root directory for discovery.
- One-click project switching through `vscode.openFolder`.
- tmux-backed terminal/session restore so long-running `codex` sessions survive workspace switches.
- Persisted per-project metadata such as pins, recents, and terminal session names.

## How it works

1. Set `Vibez: Code Directory` to the folder containing your repositories.
2. Open `Vibez: Open Project Browser`.
3. Click `Switch` on a project row.
4. Vibez reuses the current VS Code window, opens that project, then reattaches the matching tmux session if enabled.

When `vibez.tmux.bootstrapCommand` is left at the default `codex`, newly created project sessions start with `codex` automatically. Existing tmux sessions are reused as-is, which preserves the terminal conversation already running there.

## Notes

- tmux is optional but strongly recommended if you want terminal-level continuity.
- Vibez does not scrape another extension's internal conversation history. Continuity comes from persistent tmux sessions and Vibez's own per-project metadata.
