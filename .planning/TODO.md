# TODO

## Deployment
- [ ] Pin the dashboard behind a `systemd` service
- [ ] Add env file based restart guidance
- [ ] Document service health and log inspection

## Transport
- [ ] Keep the access path STUN-based and TURN-free
- [ ] Document holepunching and reconnect behavior
- [ ] Validate the browser access flow on more real networks

## Routing / settings
- [ ] Keep the global backend default and project backend override split explicit
- [ ] Add runtime fallbacks for unsupported backends
- [ ] Add project/backend resolution details to prompts and docs

## Security
- [ ] Add RBAC roles
- [ ] Add scoped API tokens
- [ ] Keep the current access-session flow as the auth bridge
