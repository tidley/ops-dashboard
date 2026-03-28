# Agentic Operations Dashboard (MVP)

Vibez is a vibe coded app for your vibe coded apps.

Self-hosted multi-agent, multi-project, multi-workflow operator dashboard.
<img width="572" height="654" alt="image" src="https://github.com/user-attachments/assets/05dee1ba-5823-4331-a3be-b3cb8e9fdc39" />

<img width="700" height="500" alt="image" src="https://github.com/user-attachments/assets/d476c317-a21e-4c03-8a6e-5aabdbaa5ea1" />


<img width="358" height="800" alt="image" src="https://github.com/user-attachments/assets/29a9e8b2-8b38-4e09-bca3-c37f8911eb7e" />


## Stack
- Node.js + Express
- EJS server-rendered UI
- SQLite (via `better-sqlite3`)
- Local filesystem namespaces per project

## Features implemented
- Project list/home dashboard with status signals
- Create projects from UI (auto-appears in sidebar/list)
- Per-project isolation primitives:
  - dedicated workspace root: `storage/projects/<project_id>/`
  - memory namespace per project
  - project-scoped sessions/messages/workflows/logs
- Threaded project conversation view with local OpenClaw routing
- Separate `OpenClaw Main` conversation namespace for direct access to the main agent
- Agent registry + routing adapters:
  - `echo` adapter (built-in)
  - `http` adapter (for external/local agent bridges)
  - `openclaw` local CLI adapter for the conversation tab
- Workflow state controls: create/run/pause/continue(done via state set)
- Persistent storage across restarts
- Public access flow with NIP-17 bootstrap, allowlisted pubkeys, and session cookies
- Browser sign-in options:
  - NIP-07 signer
  - Amber / Nostr Connect (`NIP-46`)
  - pasted `nsec` for local signing
- WebRTC data-channel gateway for browser access through a public VPS peer
- Logout and access revocation for active sessions
- Recent / favourites / archived project sidebar state persisted in SQLite

## Current status
As of 2026-03-28 UTC, the dashboard is still an MVP but the core operator flow is now stable:

- Local dashboard runs on Express + EJS + SQLite with persisted projects, sessions, messages, workflows, logs, artifacts, and access sessions.
- Access is locked down to authenticated sessions via NIP-17 bootstrap/signalling, with allowlisted pubkeys and session cookies.
- Browser sign-in supports NIP-07, Amber / Nostr Connect, and optional `nsec`.
- The access page now shows a step-by-step startup checklist and a separate client/server status flow.
- The home sidebar is lazy-loaded below `Pinned`, with `Recent` limited to the last 48 hours.
- Project pages use a fixed spatial layout with:
  - left project sidebar
  - content area
  - right expandable recent-changes rail
- `Conversations` is project-scoped.
- `OpenClaw Main` is its own separate conversation namespace and does not share history with the project chat tab.
- The project rail shows expandable file diffs for recent workspace changes.
- The dashboard has a minimal dark UI with project, usage, and control surfaces still evolving.
- The OpenClaw CLI integration is still local-process based; set `OPENCLAW_BIN` if the binary is not on `PATH`.

For a shorter operational snapshot, see [`docs/status.md`](docs/status.md).

## Run
```bash
cd /home/tom/code/ops-dashboard
npm install
npm start
# Clean restart with various host-specific parameters on port 1717
pids=$(lsof -ti:1717); [ -n "$pids" ] && kill -TERM $pids; while lsof -ti:1717 >/dev/null; do sleep 0.2; done; nohup env APP_HOST=10.10.0.2 PORT=1717 BACKEND_BASE_URL=http://10.10.0.2:1717 NODE_ENV=production OPENCLAW_BIN=/home/tom/.nvm/versions/node/v24.12.0/bin/openclaw node src/app.js >/tmp/ops-dashboard.log 2>&1 &
```

### OpenClaw integration
The project conversation tab routes to the local OpenClaw CLI by default.
If the binary is not on `PATH`, set:

- `OPENCLAW_BIN` to the executable path or name

The dashboard also passes project, session, workflow, and planning context into the OpenClaw prompt so replies stay grounded in the current workspace.
If you see plugin SDK warnings from OpenClaw, they are deprecation warnings from bundled/plugin compat imports rather than a dashboard-side failure.

### Remote access
The current remote access model is:

- `NIP-17` DMs for bootstrap/authentication and session signalling
- `WebRTC` data channel for the browser session transport
- `STUN` for candidate discovery
- `no TURN`
- direct browser-to-backend peer handoff when ICE succeeds
- optional HTTPS front door for the access page; it is not the data path

The access page supports:

- NIP-07 sign-in
- Amber / Nostr Connect on browsers such as Firefox for Android
- optional pasted `nsec`

The dashboard itself is protected by access-session middleware; unauthenticated requests are redirected to `/access` or returned `401` for API routes.
The old HTTP bootstrap and signalling routes remain available for compatibility/debugging, but the default browser flow now uses NIP-17 relay signalling and direct WebRTC peer setup.

## Dev
```bash
npm run dev
```

## Add a project
- Open `/`
- Use **Create Project** form
- Optionally attach one or more agents

## Back-fill existing repos as projects
Two options:

1) From UI: click **Back-fill from /home/tom/code** on the dashboard
2) From CLI:
```bash
cd /home/tom/code/ops-dashboard
npm run backfill
```

Behavior:
- Imports immediate directories under `/home/tom/code`
- Skips hidden dirs
- Includes `ops-dashboard` so the dashboard project itself appears in the project list
- Uses upsert-by-name (safe to run repeatedly)
- Auto-tags `pave` repos into a dedicated **Pave** section on homepage

## Add an agent
- Open `/`
- Use **Add Agent**
- `echo` kind works immediately
- `http` kind expects a JSON API endpoint receiving routing envelope:

```json
{
  "project_id":"proj-...",
  "session_id":"ses-...",
  "workflow_id":"wf-...",
  "agent_id":"agent-...",
  "message_type":"prompt",
  "priority":"normal",
  "payload":{}
}
```

Response expected:
```json
{ "reply": "text to display", "output": "optional", "...": "extra metadata" }
```

## Security / exposure
### Local first
- App binds to `127.0.0.1:4080` by default (not internet exposed)

### WireGuard exposure (recommended first)
- Run WireGuard on server
- Bind reverse proxy listener to WG interface IP only
- Forward to `127.0.0.1:4080`
- Restrict firewall to WG subnet

### HTTPS public exposure (after auth is added)
- Put a public HTTPS front door in front of the access page
- Keep the dashboard backend private unless you intentionally expose a peer endpoint
- Use NIP-17 relay signalling and STUN to set up the WebRTC session
- Let the browser and backend talk directly over WebRTC when ICE succeeds
- Keep access locked to bootstrap/session routes plus the authenticated dashboard
- Set strict headers (HSTS, X-Frame-Options, CSP, etc.)
- The access route currently defaults to a single allowlisted pubkey for operator access

For the direct relay/WebRTC version of the access flow, see:
- [`docs/deployment-vps-wireguard.md`](docs/deployment-vps-wireguard.md)

#### Caddy example
```caddy
ops.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:4080
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Frame-Options "DENY"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
  }
}
```

#### Nginx example
```nginx
server {
  listen 443 ssl http2;
  server_name ops.example.com;

  ssl_certificate /etc/letsencrypt/live/ops.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ops.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:4080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Notes on strict project isolation
- Every domain object includes `project_id`
- Queries are always filtered by `project_id`
- Separate filesystem path per project
- No cross-project retrieval route is implemented by default
- Any future cross-project feature should require explicit operator toggle and audit log entry
