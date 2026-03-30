# CONTEXT

## Product direction
- Self-hosted multi-agent operator dashboard
- Project isolation first
- Transport-first remote access
- Holepunching via relayed signalling plus direct peer transport
- STUN required; TURN intentionally out of scope
- FIPS-aware deployment posture

## State model
- SQLite stores runtime conversations/messages, workflows, sessions, logs, artifacts, and access sessions
- `.planning/` markdown stores portable project state, decisions, context, logs, risks, and actionable todos
- Global settings provide workspace defaults
- Project settings provide per-project overrides

## Routing model
- Default project backend comes from global settings
- Project backend override can inherit global or choose a specific backend
- Safe fallback remains `openclaw-proxy`
- `OpenClaw Main` stays isolated from project chat history
