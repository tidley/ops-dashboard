# NOW

1. Finish access-flow hardening
   - add e2e coverage for Amber / Nostr Connect and `nsec`
   - verify relay-signalled bootstrap and ICE handoff on real browsers
   - keep the legacy HTTP access routes only as compatibility/debug paths

2. Add Phase 2 security foundation
   - local auth (session login)
   - RBAC roles (admin/operator/viewer)
   - API token model with scope

3. Add OpenClaw native bridge adapter
   - project/session-safe routing
   - explicit envelope mapping
   - audit logging for bridge calls
