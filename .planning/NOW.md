# NOW

1. Add Phase 2 security foundation
   - local auth (session login)
   - RBAC roles (admin/operator/viewer)
   - API token model with scope

2. Add OpenClaw native bridge adapter
   - project/session-safe routing
   - explicit envelope mapping
   - audit logging for bridge calls

3. Add basic operator hardening
   - input validation + JSON parse guards
   - minimal CSRF protection for forms
   - error boundary/middleware
