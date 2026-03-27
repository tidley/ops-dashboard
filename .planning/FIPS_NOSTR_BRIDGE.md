# NIP-17 Auth + Direct WebRTC Peer Decision

## Decision

Use NIP-17 for authentication and rendezvous, and use direct WebRTC peer
signalling for the browser-backend access path.

Do not use TURN.

Legacy HTTP bootstrap and signalling routes remain in the app as compatibility
and debugging hooks, but the primary browser flow now uses relayed NIP-17
messages plus direct WebRTC peer setup.

## Why

- NIP-17 gives us pubkey-based identity, signed signalling, and relay-based
  trust decisions without exposing the backend directly to the browser.
- WebRTC data channels give us browser-native peer transport for request /
  response traffic.
- STUN is enough for candidate discovery when direct connectivity is possible.
- TURN would add a relay server in the data path, which is explicitly out of
  scope for this architecture.

## What this means

- The Nostr pubkey is the access identity.
- Relays are signalling only.
- STUN is used for ICE candidate discovery.
- The browser and backend peer directly over WebRTC when ICE succeeds.
- The backend remains private except for the WebRTC-reachable path and any
  internal service ports it needs for its own runtime.

## Implemented architecture

1. The user opens the access page.
2. The browser signs a NIP-17 bootstrap request with NIP-07, Amber /
   Nostr Connect, or a pasted `nsec`.
3. The request is published to relays.
4. The backend validates the allowlisted pubkey, nonce, and timestamp.
5. The backend replies with a bootstrap accept event.
6. The browser and backend exchange offer / answer / ICE via relayed NIP-17 DMs.
7. The browser opens a WebRTC data channel directly to the backend peer.
8. Dashboard request / response frames move over the data channel.
9. If the session is revoked or expires, the peer connection is torn down.

## Constraints carried over from `fips-nostr-bootstrap`

- Relay trust stays at zero.
- Pubkey is the identity primitive.
- Replay protection is mandatory.
- Session binding must be explicit.
- Bounded retries only.
- Structured audit logs, no secret leakage.

## Implementation status

Implemented:

- pubkey allowlist storage and revocation
- bootstrap/session issuance
- NIP-17 relay signalling
- STUN-based browser setup
- direct browser/backend WebRTC peer setup
- browser sign-in via NIP-07, Amber / Nostr Connect, and `nsec`
- access-session cookies and logout/revocation
- e2e tests for access-page bootstrap and relay access signalling

Still pending:

- RBAC roles
- scoped API tokens
- OpenClaw-native bridge
- broader browser-path e2e coverage for Amber / `nsec`

## Notes on the old gateway model

The earlier VPS gateway / WireGuard-forwarding model is no longer the primary
access design. It remains useful as a compatibility reference, but the current
browser access flow is direct peer signalling via relays.

## Open question resolved

- TURN is not used.
- If direct ICE cannot be established, the session fails closed and the user
  must retry from a network that permits direct connectivity.

---

*Decision recorded for Ops Dashboard frontend access.*
