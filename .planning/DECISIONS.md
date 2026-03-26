# DECISIONS

- Use Node + Express + EJS for low-friction server-side MVP.
- Use SQLite initially for reliability and simple ops; preserve migration path to Postgres.
- Keep app loopback-bound (`127.0.0.1`) for local-first security.
- Enforce project boundaries through explicit `project_id` scoping in storage queries.
- Use per-project filesystem roots under `storage/projects/<project_id>/`.
- Introduce agent adapters (`echo`, `http`) with a structured envelope contract.
- Import existing repos as projects via back-fill to accelerate operator onboarding.
- Split Pave and sec06 projects into dedicated dashboard sections for clarity.
