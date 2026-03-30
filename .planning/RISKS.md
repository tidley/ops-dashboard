# RISKS

1. RBAC/API-token support is still incomplete
- Risk: operator permissions remain coarse until roles and scoped tokens are added.
- Mitigation: add role checks and token scopes before broadening exposure.

2. OpenClaw-native adapter is still local CLI based
- Risk: fragmented routing strategy and manual integration overhead.
- Mitigation: add a bridge adapter with strict project/session mapping.

3. Form/input validation is still partial in some routes
- Risk: malformed payloads can cause avoidable runtime errors.
- Mitigation: add schema validation and guarded parsing.

4. SQLite concurrency limits at higher scale
- Risk: contention under heavy parallel workflow load.
- Mitigation: add migration path to Postgres and keep SQL boundary clean.

5. Direct relay signalling depends on relay availability
- Risk: login/bootstrap can stall if the configured NIP-17 relays are slow or unavailable.
- Mitigation: keep relay list configurable and retain the HTTP bootstrap path for debugging.

6. Global defaults vs project overrides can drift
- Risk: the folder-filter and onboarding split can become confusing if the defaults and project overrides are not clearly labeled.
- Mitigation: keep the settings pages explicit about what is global versus project-specific and show a preview before save.

7. OpenClaw plugin compat warnings are noisy
- Risk: deprecation warnings from bundled plugins can obscure real runtime errors.
- Mitigation: continue migrating bundled plugins away from `openclaw/plugin-sdk/compat` and keep warning filtering in place where appropriate.

8. Transport assumptions can get diluted
- Risk: TURN or other relay-heavy shortcuts could creep into the remote-access path and weaken the holepunching model.
- Mitigation: keep STUN documented as the minimum requirement and explicitly reject TURN in the architecture notes.

9. Runtime/editorial state can blur together
- Risk: if planning notes drift back into SQLite tables, the line between runtime conversations and portable project state gets muddy.
- Mitigation: keep conversations/messages in SQLite and keep editorial project state in `.planning` markdown.
