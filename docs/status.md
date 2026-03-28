# Status

Last updated: 2026-03-28 UTC

## Current state

- The dashboard is running as a local Express + EJS + SQLite app with persisted projects, sessions, messages, workflows, logs, artifacts, and access sessions.
- The home page uses a two-stage sidebar model:
  - `Pinned` stays visible first
  - `Recent` is limited to projects active in the last 48 hours
  - `Projects`, `Pave`, `sec06`, and `Archived` are loaded lazily after the page paints
- Project pages use a fixed spatial layout:
  - left project sidebar
  - content area
  - right expandable rail for recent workspace changes
- `OpenClaw Main` is separated from normal project chat and has its own conversation namespace.
- The project rail now shows recent file changes as expandable tiles with diffs.
- The access page uses NIP-17 bootstrap/signalling, supports NIP-07, Amber / Nostr Connect, and optional pasted `nsec`.
- The access flow shows a step-by-step startup checklist with client/server tags and a simple animated status trail.
- Login now always lands on the main overview page after success.

## Recent UI work

- Sidebar section headers now show counts.
- Recent projects are grouped by the last 48 hours instead of a fixed top-N slice.
- The project rail and chat composer both use bounded scroll containers so their content stays in view.
- The login logo has the animated glow treatment and the startup checklist status animation.

## Notes

- OpenClaw CLI routing remains local-process based and still depends on `OPENCLAW_BIN` if the binary is not on `PATH`.
- The remote access flow still prefers WebRTC data-channel transport after bootstrap/session establishment.
