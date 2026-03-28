# STATUS

## Objective
Build a self-hosted multi-agent, multi-project, multi-workflow operator dashboard with strict project isolation.

## Current state (2026-03-27 UTC)
- MVP web app running locally and with a direct NIP-17 relay-signaled WebRTC access path.
- Stack: Express + EJS + SQLite (`better-sqlite3`).
- Persistence enabled for projects, agents, workflows, sessions, messages, logs, artifacts, access sessions, and replay caches.
- Project isolation primitives implemented (`project_id` scoping + per-project storage dirs).
- Dashboard UI implemented with:
  - Project rail with sectioned project list
  - Project creation
  - Agent creation
  - Per-project tabbed views for overview, conversations, workflows, memory, files, logs, and settings
  - Project Settings tab with project-scoped code-folder and instructions overrides
  - Global Settings page for workspace defaults, including subfolder and ignore-folder defaults
  - Project overview usage charts
  - home-page OpenClaw control island with live runtime / model / gateway control
  - Planning/status panels surfaced from `.planning`
  - mobile sidebar drawer on narrow screens
  - mobile conversation layout with a pinned composer / action row
  - minimal dark theme with flat surfaces and tighter spacing
- Agent routing adapters implemented:
  - `echo` (built-in)
  - `http` (external endpoint)
  - `codex` (OpenAI Responses API via project UI quick action)
  - `openclaw` local CLI adapter for the conversation tab
- OpenClaw Main kept as a separate hidden namespace from project chat.
- Remote access implemented:
  - NIP-17 bootstrap/auth with allowlisted pubkeys
  - dashboard access-session cookies
  - authenticated dashboard routes
  - logout/revocation
  - browser access page with NIP-07, Amber/Nostr Connect, and `nsec` sign-in paths
  - NIP-17 relay signalling and direct browser-to-backend WebRTC peer setup
  - STUN candidate discovery for direct peer connectivity
  - direct-access e2e tests for browser bootstrap and relay signalling
  - legacy HTTP bootstrap/signal endpoints retained for compatibility/debugging
- Back-fill importer implemented:
  - Imports `/home/tom/code/*`
  - Pulls out `/home/tom/code/sec06/*` as distinct projects
  - Separates `pave` projects into dedicated UI section
  - Separates `sec06` subprojects into dedicated UI section

## Health
- Functional MVP: yes
- Production-hardening complete: partial
- Auth/RBAC/API-token support: partial
- OpenClaw-native bridge: still local CLI based
- Global workspace defaults: implemented
- Project-scoped overrides: implemented
