---
created: 2026-03-27T21:10:00.000Z
title: Add RBAC and scoped API tokens
area: security
files:
  - src/store.js
  - src/app.js
  - .planning/NOW.md
  - .planning/BACKLOG.md
---

## Problem

Access is still coarse-grained and there are no scoped API tokens yet.

## Goal

Introduce role-based permissions and scoped machine tokens so dashboard access
can be tightened without relying only on the current access-session cookie.

## Notes

- Preserve the current NIP-17 / access-session flow as the bridge.
- Roles should at minimum cover admin, operator, and viewer.
