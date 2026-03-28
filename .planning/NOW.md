# NOW

1. Finish dashboard runtime hardening
   - pin the dashboard behind a proper `systemd` unit
   - keep the current env / OpenClaw binary path documented
   - make restarts and service health easy to verify

2. Complete the settings split
   - keep Global Settings as the workspace-default editor
   - keep Project Settings scoped to project-specific overrides only
   - make the helper copy and wizard flow stay in sync with that split

3. Add the next security layer
   - RBAC roles (admin/operator/viewer)
   - scoped API token model
   - keep the current access-session flow as the auth bridge
