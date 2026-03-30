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
- Treat STUN as the minimum transport dependency for browser access; do not add TURN to the data path.
- Keep the browser sign-in paths flexible: NIP-07, Amber / Nostr Connect, and `nsec`.
- Keep the legacy HTTP bootstrap / signalling routes as compatibility and debugging hooks while the direct peer path matures.
- Prefer a minimal flat dark theme with dense spacing and simple borders over gradient-heavy surfaces.
- Use `app_settings` for global workspace defaults and keep project settings as project-scoped overrides.
- Keep the global agent backend default separate from the project backend override and resolve it at runtime with a safe `openclaw-proxy` fallback.
- Store portable project state in `.planning/` markdown files rather than SQLite rows where the data is editorial rather than runtime state.
- Keep `Project Settings` in the project header and expose `Global Settings` as a separate top-level screen.
- Keep `OpenClaw Main` as a separate hidden namespace from project conversations.
