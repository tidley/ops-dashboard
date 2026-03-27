---
created: 2026-03-27T00:32:42.376Z
title: Document handshake and handoff patterns
area: docs
files:
  - docs/deployment-vps-wireguard.md
  - README.md
  - src/views/access.ejs
---

## Problem

The access-flow conversation introduced several related architecture choices that are easy to lose in chat:

- direct browser-backend P2P over WebRTC
- gateway-only handshake with direct handoff
- gateway-relay fallback for firewall-only backends
- the distinction between NIP-17 control/auth and the actual transport plane
- the mobile sign-in path using NIP-07, Amber / Nostr Connect, or `nsec`

The current docs describe the active VPS + WireGuard deployment, but they do not yet present the alternative deployment patterns side by side or explain when each model is appropriate.

## Solution

Add a short architecture note that compares the three transport patterns side by side and clarifies:

1. what the browser can do directly
2. when the VPS gateway is only a rendezvous/handshake peer
3. when the VPS must remain in the data path
4. how pubkey auth, NIP-17, Amber/NIP-46, and STUN fit into each pattern

Use it to keep the deployment story aligned with the implementation and to avoid re-litigating the same design trade-offs in chat.
