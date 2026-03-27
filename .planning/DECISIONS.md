# DECISIONS

- Use Node + Express + EJS for low-friction server-side MVP.
- Use SQLite initially for reliability and simple ops; preserve migration path to Postgres.
- Keep app loopback-bound (`127.0.0.1`) for local-first security.
- Enforce project boundaries through explicit `project_id` scoping in storage queries.
- Use per-project filesystem roots under `storage/projects/<project_id>/`.
- Introduce agent adapters (`echo`, `http`) with a structured envelope contract.
- Import existing repos as projects via back-fill to accelerate operator onboarding.
- Split Pave and sec06 projects into dedicated dashboard sections for clarity.
- Use NIP-17 auth plus relay-signalled WebRTC access for remote dashboard access, and do not use TURN.
- Keep the browser sign-in paths flexible: NIP-07, Amber / Nostr Connect, and `nsec`.
- Keep the legacy HTTP bootstrap / signalling routes as compatibility and debugging hooks while the direct peer path matures.
- Prefer a minimal flat dark theme with dense spacing and simple borders over gradient-heavy surfaces.
