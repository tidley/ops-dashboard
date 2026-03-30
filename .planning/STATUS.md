# STATUS

## Objective
Build a self-hosted, transport-first multi-agent, multi-project, multi-workflow operator dashboard with strict project isolation, holepunch-friendly remote access, and FIPS-aware deployment posture.

## Current state (2026-03-30 UTC)
- MVP web app running locally with a direct NIP-17 relay-signaled WebRTC access path.
- Stack: Express + EJS + SQLite (`better-sqlite3`).
- Persistence enabled for projects, conversations/messages, workflows, sessions, logs, artifacts, access sessions, and replay caches.
- Project isolation primitives implemented (`project_id` scoping + per-project storage dirs).
- Dashboard UI implemented with:
  - Project rail with sectioned project list
  - Project creation
  - Agent creation
  - Per-project tabbed views for overview, conversations, workflows, memory, files, logs, and settings
  - Global Settings page for workspace defaults and backend defaults
  - Project Settings tab with project-scoped backend override plus code-folder and instructions overrides
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
  - no TURN in the browser data path
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
- Transport hardening: partial
- Auth/RBAC/API-token support: partial
- OpenClaw-native bridge: still local CLI based
- Global workspace defaults: implemented
- Project-scoped overrides: implemented
