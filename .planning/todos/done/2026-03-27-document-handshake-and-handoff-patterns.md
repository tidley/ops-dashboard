---
created: 2026-03-27T00:32:42.376Z
title: Document handshake and handoff patterns
area: docs
files:
  - .planning/deployment-vps-wireguard.md
  - README.md
  - src/views/access.ejs
---

## Problem

The access-flow conversation introduced several related architecture choices
that are easy to lose in chat:

- direct browser-backend P2P over WebRTC
- gateway-only handshake with direct handoff
- gateway-relay fallback for firewall-only backends
- the distinction between NIP-17 control/auth and the actual transport plane
- the mobile sign-in path using NIP-07, Amber / Nostr Connect, or `nsec`

## Resolution

The docs now cover the current access model:

1. direct browser-backend peer signalling over relays and STUN
2. when a gateway is only a rendezvous / compatibility peer
3. when a relay or gateway would still need to remain in the data path
4. the current mobile sign-in paths using NIP-07, Amber / Nostr Connect, or
   `nsec`

Updated files:

- [`README.md`](/home/tom/code/ops-dashboard/README.md)
- [`.planning/FIPS_NOSTR_BRIDGE.md`](/home/tom/code/ops-dashboard/.planning/FIPS_NOSTR_BRIDGE.md)
- [`.planning/deployment-vps-wireguard.md`](/home/tom/code/ops-dashboard/.planning/deployment-vps-wireguard.md)
