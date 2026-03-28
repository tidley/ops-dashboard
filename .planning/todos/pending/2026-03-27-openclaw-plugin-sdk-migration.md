---
created: 2026-03-27T21:10:00.000Z
title: Migrate bundled OpenClaw plugins off compat imports
area: openclaw
files:
  - src/openclaw-control.js
  - .planning/DECISIONS.md
  - .planning/RISKS.md
---

## Problem

Bundled plugins still emit warnings about `openclaw/plugin-sdk/compat`, which
clutters the runtime and can hide real failures.

## Goal

Move bundled plugin code to scoped plugin-sdk subpaths and keep the dashboard
logs focused on actionable errors only.

## Notes

- External plugins can remain on compat during migration.
- Keep the warning filtering in place until the bundled plugin tree is clean.
