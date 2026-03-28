const { SimplePool, nip17, verifyEvent, finalizeEvent, nip19 } = require('nostr-tools');
const { ACCESS_APP, handleBootstrapEvent, loadGatewayIdentity } = require('./nostr-auth');

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseRelayUrls(raw) {
  return `${raw || ''}`
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(relay => (relay.includes('://') ? relay : `wss://${relay}`))
    .filter((relay, index, arr) => arr.indexOf(relay) === index);
}

function defaultRelayUrls() {
  return parseRelayUrls(
    process.env.NOSTR_RELAY_URLS ||
    process.env.NOSTR_RELAYS ||
    [
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://relay.nostr.band',
      'wss://relay.snort.social',
      'wss://nos.lol',
      'wss://nostr.mom',
    ].join(','),
  );
}

function unwrapEventWithGateway(event, gatewayIdentity) {
  const signedOk = event && typeof event === 'object' && verifyEvent(event);
  if (!signedOk) {
    return { ok: false, error: 'invalid_signature' };
  }

  try {
    const rumor = nip17.unwrapEvent(event, gatewayIdentity.sk);
    const payload = parseJson(rumor.content, {});
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'invalid_payload' };
    }
    if (payload.app !== ACCESS_APP) {
      return { ok: false, error: 'invalid_app' };
    }
    return {
      ok: true,
      senderPubkey: (rumor.pubkey || event.pubkey || '').trim(),
      payload,
      envelope: 'nip17',
    };
  } catch (err) {
    const payload = parseJson(event.content, {});
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: `unwrap_failed:${String(err.message || err)}` };
    }
    if (payload.app !== ACCESS_APP) {
      return { ok: false, error: 'invalid_app' };
    }
    return {
      ok: true,
      senderPubkey: (event.pubkey || '').trim(),
      payload,
      envelope: 'plain',
    };
  }
}

function wrapPayloadForPeer(payload, gatewayIdentity, peerPubkey) {
  return nip17.wrapEvent(
    gatewayIdentity.sk,
    { publicKey: peerPubkey },
    JSON.stringify(payload),
  );
}

class NostrRelayAccessController {
  constructor({
    store,
    webRtcGateway,
    gatewayIdentity = loadGatewayIdentity(),
    relays = defaultRelayUrls(),
    logger = console,
  } = {}) {
    this.store = store;
    this.webRtcGateway = webRtcGateway;
    this.gatewayIdentity = gatewayIdentity;
    this.relays = relays;
    this.logger = logger;
    this.pool = new SimplePool({
      verifyEvent,
      websocketImplementation: global.WebSocket,
      maxWaitForConnection: 5000,
      enablePing: true,
      enableReconnect: true,
    });
    this.subscription = null;
    this.seenEventIds = new Set();
  }

  start() {
    if (this.subscription || !this.relays.length) return this;

    this.subscription = this.pool.subscribeMany(
      this.relays,
      { kinds: [1059], '#p': [this.gatewayIdentity.pubkey] },
      {
        onevent: (event) => {
          this.handleEvent(event).catch(err => {
            this.logger.error('[relay-access] event handling failed', err);
          });
        },
        oninvalidevent: (event) => {
          this.logger.warn('[relay-access] invalid event received', event?.id || '');
        },
      },
    );

    this.logger.info('[relay-access] listening on relays', this.relays.join(', '));
    return this;
  }

  stop() {
    if (this.subscription) {
      try {
        this.subscription.close('relay-access stopped');
      } catch {}
      this.subscription = null;
    }
    try {
      this.pool.destroy();
    } catch {}
    this.seenEventIds.clear();
  }

  async handleEvent(event) {
    if (!event || this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);

    const unwrapped = unwrapEventWithGateway(event, this.gatewayIdentity);
    if (!unwrapped.ok) return;

    const { senderPubkey, payload, envelope } = unwrapped;
    const sessionId = `${payload.session_id || ''}`.trim();
    const type = `${payload.type || ''}`.trim();

    if (!sessionId || !type) return;

    if (type === 'bootstrap_request') {
      const result = handleBootstrapEvent({
        event,
        gatewayIdentity: this.gatewayIdentity,
        metadata: {
          source: 'nostr-relay',
          relay_urls: this.relays,
          user_agent: `${payload.user_agent || ''}`.trim(),
          requested_transport: payload.transport || 'webrtc-direct',
          signal_envelope: envelope || 'nip17',
        },
      });

      if (!result.ok) {
        await this.sendPayload(senderPubkey, {
          app: ACCESS_APP,
          type: 'bootstrap_reject',
          session_id: sessionId,
          ok: false,
          error: result.error,
          signal_envelope: envelope || 'nip17',
        });
        return;
      }

      await this.sendPayload(senderPubkey, {
        app: ACCESS_APP,
        type: 'bootstrap_accept',
        session_id: result.session.id,
        ok: true,
        gateway_pubkey: this.gatewayIdentity.pubkey,
        gateway_npub: nip19.npubEncode(this.gatewayIdentity.pubkey),
        relay_urls: this.relays,
        signal_transport: 'nostr-relay',
        transport: 'webrtc-direct',
        stun_urls: [process.env.FIPS_STUN_URL || 'stun:fips.tomdwyer.uk:3478'],
        session: result.session,
        signal_url: `/api/access/sessions/${result.session.id}/signal`,
        proxy_url: `/api/access/sessions/${result.session.id}/proxy`,
        signal_envelope: result.session?.metadata_json?.signal_envelope || envelope || 'nip17',
        bootstrap_cookie_token: result.bootstrap_cookie_token || result.session?.metadata_json?.bootstrap_cookie_token || '',
      });
      return;
    }

    const sessionCheck = this.webRtcGateway.ensureSession(sessionId);
    if (!sessionCheck.ok) {
      await this.sendPayload(senderPubkey, {
        app: ACCESS_APP,
        type: `${type}_error`,
        session_id: sessionId,
        ok: false,
        error: sessionCheck.error,
        signal_envelope: envelope || 'nip17',
      });
      return;
    }

    const session = sessionCheck.session;
    const responseEnvelope = session.accessSession?.metadata_json?.signal_envelope || envelope || 'nip17';
    if (session.accessSession?.pubkey && session.accessSession.pubkey !== senderPubkey) {
      await this.sendPayload(senderPubkey, {
        app: ACCESS_APP,
        type: `${type}_error`,
        session_id: sessionId,
        ok: false,
        error: 'pubkey_mismatch',
        signal_envelope: responseEnvelope,
      });
      return;
    }

    const signal = {
      type,
      sdp: payload.sdp,
      candidate: payload.candidate,
      reason: payload.reason,
    };

    const result = await this.webRtcGateway.handleSignal(sessionId, signal);
    if (!result.ok) {
      await this.sendPayload(senderPubkey, {
        app: ACCESS_APP,
        type: `${type}_error`,
        session_id: sessionId,
        ok: false,
        error: result.error,
        signal_envelope: responseEnvelope,
      });
      return;
    }

    const responseType = result.type || (type === 'offer' ? 'answer' : type);
    await this.sendPayload(senderPubkey, {
      app: ACCESS_APP,
      type: responseType,
      session_id: sessionId,
      ok: true,
      sdp: result.sdp || null,
      candidates: result.candidates || [],
      signal: result.signal || null,
      signal_envelope: responseEnvelope,
    });
  }

  async sendPayload(toPubkey, payload) {
    if (!toPubkey) return;
    const event = payload.signal_envelope === 'plain'
      ? finalizeEvent({
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', toPubkey]],
        content: JSON.stringify(payload),
      }, this.gatewayIdentity.sk)
      : wrapPayloadForPeer(payload, this.gatewayIdentity, toPubkey);
    const promises = this.pool.publish(this.relays, event);
    await Promise.allSettled(promises);
  }
}

module.exports = {
  NostrRelayAccessController,
  defaultRelayUrls,
  parseRelayUrls,
  unwrapEventWithGateway,
  wrapPayloadForPeer,
};
