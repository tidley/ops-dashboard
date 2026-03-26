# RISKS

1. No auth/RBAC yet
- Risk: unauthorized local/network use if exposure changes.
- Mitigation: implement auth + role checks before any public exposure.

2. No OpenClaw-native adapter yet
- Risk: fragmented routing strategy and manual integration overhead.
- Mitigation: add bridge adapter with strict project/session mapping.

3. Form/input validation is minimal
- Risk: malformed payloads can cause avoidable runtime errors.
- Mitigation: add schema validation and guarded parsing.

4. SQLite concurrency limits at higher scale
- Risk: contention under heavy parallel workflow load.
- Mitigation: add migration path to Postgres and keep SQL boundary clean.
