# STATUS

## Objective
Build a self-hosted multi-agent, multi-project, multi-workflow operator dashboard with strict project isolation.

## Current state (2026-03-26 UTC)
- MVP web app running locally on `127.0.0.1:4080`.
- Stack: Express + EJS + SQLite (`better-sqlite3`).
- Persistence enabled for projects, agents, workflows, sessions, messages, logs, artifacts.
- Project isolation primitives implemented (`project_id` scoping + per-project storage dirs).
- Dashboard UI implemented with:
  - Project rail with sectioned project list
  - Project creation
  - Agent creation
  - Per-project tabbed conversation/workflow/log views
  - Planning/status panels surfaced from `.planning`
- Agent routing adapters implemented:
  - `echo` (built-in)
  - `http` (external endpoint)
- Back-fill importer implemented:
  - Imports `/home/tom/code/*`
  - Pulls out `/home/tom/code/sec06/*` as distinct projects
  - Separates `pave` projects into dedicated UI section
  - Separates `sec06` subprojects into dedicated UI section

## Health
- Functional MVP: yes
- Production-hardening complete: no
- Auth/RBAC/API-token support: pending
- OpenClaw-native bridge: pending
