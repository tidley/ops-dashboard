---
created: 2026-03-27T21:10:00.000Z
title: Pin the dashboard behind a systemd service
area: ops
files:
  - src/app.js
  - README.md
  - .planning/NOW.md
---

## Problem

The dashboard is still started manually and can drop its listener if the shell
session or background process gets reaped.

## Goal

Run the dashboard as a proper `systemd` service so the listener survives
restarts and host logins.

## Notes

- Keep the current `APP_HOST`, `PORT`, `BACKEND_BASE_URL`, and `OPENCLAW_BIN`
  values documented.
- Include service status / restart checks in the README and planning docs.
