# Ops Dashboard (MVP)

Self-hosted multi-agent, multi-project, multi-workflow operator dashboard.

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
- Structured project conversation form with routing metadata fields
- Agent registry + routing adapters:
  - `echo` adapter (built-in)
  - `http` adapter (for external/local agent bridges)
- Workflow state controls: create/run/pause/continue(done via state set)
- Persistent storage across restarts

## Run
```bash
cd /home/tom/code/ops-dashboard
npm install
npm start
# open http://127.0.0.1:4080
```

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
- Skips hidden dirs and `ops-dashboard`
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
- Put Caddy/Nginx in front
- Keep app loopback-only
- Enable TLS termination in proxy
- Add authentication middleware before public exposure (basic auth/OIDC)
- Set strict headers (HSTS, X-Frame-Options, CSP, etc.)

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
