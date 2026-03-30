# NOW

1. Finish dashboard runtime hardening
   - pin the dashboard behind a proper `systemd` unit
   - keep the current env / OpenClaw binary path documented
   - make restarts and service health easy to verify

2. Lock the transport path
   - keep STUN as the minimum required peer-discovery service
   - do not introduce TURN into the access path
   - make holepunching / reconnect behavior explicit in docs and prompts

3. Complete the backend split
   - keep Global Settings as the workspace-default backend editor
   - keep Project Settings scoped to project-specific backend overrides only
   - keep the runtime resolution order explicit: project override -> global default -> safe fallback
