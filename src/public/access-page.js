(function() {
  function qs(id) {
    return document.getElementById(id);
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function setText(el, value) {
    if (el) el.textContent = value;
  }

  function parseNsec(value) {
    const raw = `${value || ''}`.trim();
    if (!raw) throw new Error('nsec_required');
    if (!window.NostrTools || !window.NostrTools.nip19) throw new Error('nostr_tools_unavailable');
    const decoded = window.NostrTools.nip19.decode(raw);
    if (decoded.type !== 'nsec') throw new Error('invalid_nsec');
    return decoded.data;
  }

  function buildPayload() {
    const issuedAt = Date.now();
    return {
      app: window.ACCESS_GATEWAY.app,
      type: 'bootstrap_request',
      session_id: `acc-${issuedAt}-${randomId().slice(0, 8)}`,
      nonce: randomId(),
      scope: 'dashboard',
      transport: 'webrtc-direct',
      relay_urls: currentRelayUrls(),
      stun_urls: [window.FIPS_STUN_URL || 'stun:fips.tomdwyer.uk:3478'],
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(issuedAt + 10 * 60 * 1000).toISOString(),
    };
  }

  function getNip44Encryptor(nostr) {
    if (!nostr) return null;
    if (nostr.nip44 && typeof nostr.nip44.encrypt === 'function') {
      return (recipientPubkey, plaintext) => nostr.nip44.encrypt(recipientPubkey, plaintext);
    }
    if (typeof nostr.nip44Encrypt === 'function') {
      return (recipientPubkey, plaintext) => nostr.nip44Encrypt(recipientPubkey, plaintext);
    }
    return null;
  }

  function getNip44Decryptor(nostr) {
    if (!nostr) return null;
    if (nostr.nip44 && typeof nostr.nip44.decrypt === 'function') {
      return (senderPubkey, payload) => nostr.nip44.decrypt(senderPubkey, payload);
    }
    if (typeof nostr.nip44Decrypt === 'function') {
      return (senderPubkey, payload) => nostr.nip44Decrypt(senderPubkey, payload);
    }
    return null;
  }

  function parseSignalPayload(event) {
    try {
      const parsed = JSON.parse(event.content || '{}');
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
    return null;
  }

  function normalizeRelayUrls(raw) {
    return `${raw || ''}`
      .split(/[\s,]+/)
      .map(value => value.trim())
      .filter(Boolean)
      .map(relay => {
        if (relay.includes('://')) return relay;
        return `wss://${relay}`;
      })
      .filter((relay, index, arr) => arr.indexOf(relay) === index);
  }

  function currentRelayUrls() {
    const field = document.getElementById('amber_relays');
    const raw = (field && field.value) || (window.ACCESS_GATEWAY && window.ACCESS_GATEWAY.relayUrls) || '';
    return normalizeRelayUrls(raw);
  }

  function getSimplePool() {
    if (!window.NostrTools || typeof window.NostrTools.SimplePool !== 'function') {
      throw new Error('nostr_tools_pool_unavailable');
    }
    return new window.NostrTools.SimplePool();
  }

  function getRandomSecret() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${window.crypto.randomUUID()}-${randomId()}`;
    }
    return `${randomId()}-${randomId()}`;
  }

  function openExternalUri(uri) {
    if (!uri) return false;
    try {
      const link = document.createElement('a');
      link.href = uri;
      link.rel = 'noreferrer noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
    } catch {
      try {
        window.location.href = uri;
        return true;
      } catch {
        return false;
      }
    }
  }

  function getNextUrl() {
    try {
      const search = (window.location && window.location.search) || '';
      const params = new URLSearchParams(search);
      return params.get('next') || '/';
    } catch {
      return '/';
    }
  }

  function navigateToNextUrl() {
    const nextUrl = getNextUrl();
    if (window.location && typeof window.location.assign === 'function') {
      window.location.assign(nextUrl);
      return;
    }
    if (window.location) {
      window.location.href = nextUrl;
    }
  }

  async function connectWithTimeout(client, timeoutMs = 15000) {
    return Promise.race([
      client.connect(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('webrtc_connect_timeout')), timeoutMs);
      }),
    ]);
  }

  async function confirmSessionCookie(sessionId, token) {
    if (!sessionId || !token) return false;
    const res = await fetch(`/api/access/sessions/${encodeURIComponent(sessionId)}/confirm`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ token }),
    });
    const json = await res.json().catch(function() { return {}; });
    if (!res.ok || !json.ok) {
      throw new Error(json.error || `confirm_failed:${res.status}`);
    }
    return true;
  }

  let nip46ModulePromise = null;
  async function loadNip46Module() {
    if (nip46ModulePromise) return nip46ModulePromise;
    nip46ModulePromise = import('/public/vendor/nip46.bundle.js');
    return nip46ModulePromise;
  }

  function createLocalSignerAdapterFromNsec(nsecValue) {
    const secretKey = parseNsec(nsecValue);
    const publicKey = window.NostrTools.getPublicKey(secretKey);

    return {
      getPublicKey() {
        return publicKey;
      },
      async signEvent(event) {
        return window.NostrTools.finalizeEvent({ ...event }, secretKey);
      },
      async nip44Encrypt(recipientPubkey, plaintext) {
        const conversationKey = window.NostrTools.nip44.getConversationKey(secretKey, recipientPubkey);
        return window.NostrTools.nip44.encrypt(plaintext, conversationKey);
      },
      async nip44Decrypt(senderPubkey, payload) {
        const conversationKey = window.NostrTools.nip44.getConversationKey(secretKey, senderPubkey);
        return window.NostrTools.nip44.decrypt(payload, conversationKey);
      },
    };
  }

  async function unwrapGiftWrapWithSigner(event, signer) {
    const decrypt = getNip44Decryptor(signer);
    if (!decrypt) throw new Error('nip44_decrypt_unavailable');

    const outer = await decrypt(event.pubkey, event.content);
    const seal = JSON.parse(outer);
    const rumorText = await decrypt(event.pubkey, seal.content);
    const rumor = JSON.parse(rumorText);
    return { seal, rumor };
  }

  class RelaySignalTransport {
    constructor({ relays, signer, gatewayPubkey, inboxPubkey = '', envelopeMode = 'nip17' }) {
      this.relays = relays;
      this.signer = signer;
      this.gatewayPubkey = gatewayPubkey;
      this.envelopeMode = envelopeMode;
      this.pool = getSimplePool();
      this.subscription = null;
      this.inboxPubkey = `${inboxPubkey || ''}`.trim();
      this.waiters = new Map();
      this.seen = new Set();
      this.sessionId = '';
      this.ready = null;
    }

    async init() {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        if (!this.inboxPubkey) {
          this.inboxPubkey = await this.signer.getPublicKey();
        }
        this.subscription = this.pool.subscribe(
          this.relays,
          { kinds: [1059], '#p': [this.inboxPubkey] },
          {
            onevent: (event) => {
              this.handleEvent(event).catch(function() {});
            },
          },
        );
        return this;
      })();
      return this.ready;
    }

    waitFor(sessionId, types, timeoutMs = 45000) {
      return new Promise((resolve, reject) => {
        const timers = [];
        const cleanup = () => {
          timers.forEach(timer => clearTimeout(timer));
        };

        types.forEach(type => {
          const key = `${sessionId}:${type}`;
          const list = this.waiters.get(key) || [];
          list.push({ resolve, reject, cleanup });
          this.waiters.set(key, list);
        });

        timers.push(setTimeout(() => {
          cleanup();
          reject(new Error('relay_signal_timeout'));
        }, timeoutMs));
      });
    }

    fulfill(payload) {
      const sessionId = `${payload.session_id || payload.session?.id || ''}`.trim();
      const type = `${payload.type || ''}`.trim();
      if (!sessionId || !type) return false;

      const key = `${sessionId}:${type}`;
      const waiters = this.waiters.get(key);
      if (!waiters || !waiters.length) return false;

      this.waiters.delete(key);
      for (const waiter of waiters) {
        try {
          waiter.cleanup();
        } catch {}
        waiter.resolve(payload);
      }
      return true;
    }

    async handleEvent(event) {
      if (!event || this.seen.has(event.id)) return;
      this.seen.add(event.id);

      let payload;
      if (this.envelopeMode === 'plain') {
        payload = parseSignalPayload(event);
      } else {
        try {
          const wrapped = await unwrapGiftWrapWithSigner(event, this.signer);
          payload = wrapped.rumor;
        } catch {
          payload = parseSignalPayload(event);
        }
      }

      if (!payload || payload.app !== window.ACCESS_GATEWAY.app) return;
      this.fulfill(payload);
      if (payload.type === 'bootstrap_accept' && payload.session?.id) {
        this.sessionId = payload.session.id;
      }
      if (!this.sessionId && payload.session_id) {
        this.sessionId = payload.session_id;
      }
    }

    async sendPayload(payload, waitTypes = []) {
      await this.init();
      const sessionId = `${payload.session_id || this.sessionId || ''}`.trim();
      const waitPromise = waitTypes.length ? this.waitFor(sessionId, waitTypes) : null;
      const event = this.envelopeMode === 'plain'
        ? await this.signer.signEvent({
          kind: 1059,
          created_at: Math.ceil(Date.now() / 1000),
          tags: [['p', this.gatewayPubkey]],
          content: JSON.stringify(payload),
        })
        : await buildWrappedEventWithSigner(payload, this.signer, this.gatewayPubkey);
      const publishPromises = this.pool.publish(this.relays, event);
      await Promise.allSettled(publishPromises);
      if (!waitPromise) return { ok: true };
      return waitPromise;
    }

    async bootstrap(event, bootstrapMeta = {}) {
      await this.init();
      const payload = bootstrapMeta.payload || {};
      const sessionId = `${payload.session_id || bootstrapMeta.session_id || ''}`.trim();
      if (!sessionId) throw new Error('missing_session_id');
      const waitPromise = this.waitFor(sessionId, ['bootstrap_accept', 'bootstrap_reject']);
      const publishPromises = this.pool.publish(this.relays, event);
      await Promise.allSettled(publishPromises);
      const response = await waitPromise;
      if (response.type === 'bootstrap_accept' && response.session?.id) {
        this.sessionId = response.session.id;
      }
      return response;
    }

    async signal(signal) {
      await this.init();
      const sessionId = this.sessionId || `${signal.session_id || ''}`.trim();
      if (!sessionId) throw new Error('missing_session_id');
      const payload = {
        app: window.ACCESS_GATEWAY.app,
        session_id: sessionId,
        type: `${signal.type || ''}`.trim(),
        sdp: signal.sdp || null,
        candidate: signal.candidate || null,
        reason: signal.reason || '',
      };

      if (payload.type === 'ice' || payload.type === 'close') {
        void this.sendPayload(payload);
        return { ok: true, type: payload.type, session_id: sessionId };
      }

      const response = await this.sendPayload(payload, [payload.type === 'offer' ? 'answer' : payload.type]);
      return response;
    }

    close() {
      try {
        this.subscription && this.subscription.close('relay-transport closed');
      } catch {}
      try {
        this.pool.destroy();
      } catch {}
      this.waiters.forEach(waiters => {
        waiters.forEach(waiter => {
          try { waiter.cleanup(); } catch {}
          waiter.reject(new Error('relay_transport_closed'));
        });
      });
      this.waiters.clear();
      this.subscription = null;
      this.ready = null;
    }
  }

  function createRelayTransport(signer, inboxPubkey = '', envelopeMode = 'nip17') {
    return new RelaySignalTransport({
      relays: currentRelayUrls(),
      signer,
      gatewayPubkey: window.ACCESS_GATEWAY.gatewayPubkey,
      inboxPubkey,
      envelopeMode,
    });
  }

  async function buildSignedEventWithNip07(payload) {
    const nostr = window.nostr;
    if (!nostr || typeof nostr.signEvent !== 'function') {
      throw new Error('nip07_not_available');
    }
    const now = Math.ceil(Date.now() / 1000);
    return nostr.signEvent({
      kind: 1059,
      created_at: now,
      tags: [['p', window.ACCESS_GATEWAY.gatewayPubkey]],
      content: JSON.stringify(payload),
    });
  }

  async function buildSignedEventWithSigner(payload, signer) {
    if (!signer || typeof signer.signEvent !== 'function') {
      throw new Error('signer_unavailable');
    }
    const now = Math.ceil(Date.now() / 1000);
    return signer.signEvent({
      kind: 1059,
      created_at: now,
      tags: [['p', window.ACCESS_GATEWAY.gatewayPubkey]],
      content: JSON.stringify(payload),
    });
  }

  function buildWrappedEventWithNsec(payload, nsecValue) {
    const senderSk = parseNsec(nsecValue);
    return window.NostrTools.nip17.wrapEvent(
      senderSk,
      { publicKey: window.ACCESS_GATEWAY.gatewayPubkey },
      JSON.stringify(payload),
    );
  }

  async function buildWrappedEventWithSigner(payload, signer) {
    if (!signer || typeof signer.getPublicKey !== 'function' || typeof signer.signEvent !== 'function') {
      throw new Error('signer_unavailable');
    }

    const encrypt = getNip44Encryptor(signer);
    if (!encrypt) throw new Error('nip44_encrypt_unavailable');

    const now = Math.ceil(Date.now() / 1000);
    const rumor = {
      created_at: now,
      kind: 14,
      tags: [['p', window.ACCESS_GATEWAY.gatewayPubkey]],
      content: JSON.stringify(payload),
    };

    const seal = await signer.signEvent({
      kind: 13,
      created_at: now,
      tags: [],
      content: await encrypt(window.ACCESS_GATEWAY.gatewayPubkey, JSON.stringify(rumor)),
    });

    return signer.signEvent({
      kind: 1059,
      created_at: now,
      tags: [['p', window.ACCESS_GATEWAY.gatewayPubkey]],
      content: await encrypt(window.ACCESS_GATEWAY.gatewayPubkey, JSON.stringify(seal)),
    });
  }

  async function closeAmberRuntime(runtime) {
    if (!runtime) return;
    if (runtime.signer && typeof runtime.signer.close === 'function') {
      try {
        await runtime.signer.close();
      } catch {}
    }
    if (runtime.pool && typeof runtime.pool.close === 'function') {
      try {
        runtime.pool.close([]);
      } catch {}
    }
  }

  async function bootstrapWithEvent(client, event, payload) {
    const result = await client.bootstrap('/api/access/bootstrap', event, { payload: payload || {} });
    setText(sessionIdEl, result.session.id);
    setText(signalUrlEl, result.signal_url);
    setText(proxyUrlEl, result.proxy_url);
    eventJson.value = JSON.stringify(event, null, 2);
    if (result.bootstrap_cookie_token) {
      try {
        await confirmSessionCookie(result.session.id, result.bootstrap_cookie_token);
      } catch (err) {
        setPreview(String(err && err.message ? err.message : err));
      }
    }
    setAccessStage('connecting');
    setPreview('Connecting WebRTC data channel...');
    try {
      await connectWithTimeout(client);
      setAccessStage('session');
      setPreview('Connected to access session ' + client.sessionId);
    } catch (err) {
      try {
        client.close();
      } catch {}
      setPreview('WebRTC unavailable, continuing with the authenticated dashboard...');
      setTimeout(navigateToNextUrl, 500);
    }
    return result;
  }

  function setPreview(value) {
    preview.textContent = value;
  }

  var nip07LoginBtn = qs('nip07_login_btn');
  var amberTab = qs('amber_tab');
  var nsecTab = qs('nsec_tab');
  var nip07Tab = qs('nip07_tab');
  var nsecBtn = qs('nsec_login_btn');
  var bootstrapBtn = qs('bootstrap_btn');
  var connectBtn = qs('connect_btn');
  var fetchBtn = qs('fetch_btn');
  var amberLoginBtn = qs('amber_login_btn');
  var amberRelays = qs('amber_relays');
  var amberUri = qs('amber_uri');
  var nsecValue = qs('nsec_value');
  var eventJson = qs('event_json');
  var preview = qs('preview');
  var sessionIdEl = qs('session_id');
  var signalUrlEl = qs('signal_url');
  var proxyUrlEl = qs('proxy_url');
  var sessionMeta = qs('session_meta');
  var nip07Panel = qs('nip07_panel');
  var amberPanel = qs('amber_panel');
  var nsecPanel = qs('nsec_panel');
  var authMode = 'nip07';
  var sessionStage = qs('session_stage');
  var client = null;
  var amberRuntime = null;

  function setTabActive(tabEl, isActive) {
    if (!tabEl) return;
    if (typeof tabEl.setAttribute === 'function') {
      tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    } else {
      tabEl.ariaSelected = isActive ? 'true' : 'false';
    }
    if (tabEl.classList && typeof tabEl.classList.toggle === 'function') {
      tabEl.classList.toggle('is-active', Boolean(isActive));
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    if (nip07Panel) nip07Panel.hidden = mode !== 'nip07';
    if (amberPanel) amberPanel.hidden = mode !== 'amber';
    if (nsecPanel) nsecPanel.hidden = mode !== 'nsec';
    setTabActive(nip07Tab, mode === 'nip07');
    setTabActive(amberTab, mode === 'amber');
    setTabActive(nsecTab, mode === 'nsec');
  }

  function setAccessStage(stage) {
    if (sessionStage) sessionStage.hidden = stage !== 'session';
    if (sessionMeta) sessionMeta.hidden = stage !== 'session';
    if (connectBtn) connectBtn.hidden = true;
    if (fetchBtn) fetchBtn.disabled = stage !== 'session' || !client || !client.connected;
  }

  function clearSessionFields() {
    setText(sessionIdEl, '(none)');
    setText(signalUrlEl, '(none)');
    setText(proxyUrlEl, '(none)');
  }

  setAccessStage('auth');
  setAuthMode('nip07');
  clearSessionFields();

  nip07Tab.addEventListener('click', function() {
    setAuthMode('nip07');
  });

  amberTab.addEventListener('click', function() {
    setAuthMode('amber');
  });

  nsecTab.addEventListener('click', function() {
    setAuthMode('nsec');
  });

  nip07LoginBtn.addEventListener('click', async function() {
    try {
      setAccessStage('auth');
      setPreview('Waiting for NIP-07 approval...');
      const payload = buildPayload();
      const event = await buildSignedEventWithNip07(payload);
      const signalTransport = createRelayTransport(window.nostr, event.pubkey, 'plain');
      client = new window.AccessWebRtcProxy({ signalTransport });
      setPreview('Bootstrapping access...');
      await bootstrapWithEvent(client, event, payload);
    } catch (err) {
      setPreview(String(err && err.message ? err.message : err));
    }
  });

  amberLoginBtn.addEventListener('click', async function() {
    try {
      await closeAmberRuntime(amberRuntime);
      amberRuntime = null;
      const relays = normalizeRelayUrls(amberRelays.value);
      if (!relays.length) throw new Error('amber_relays_required');
      if (!window.NostrTools || typeof window.NostrTools.generateSecretKey !== 'function' || typeof window.NostrTools.getPublicKey !== 'function') {
        throw new Error('nostr_tools_unavailable');
      }

      setPreview('Preparing Amber / Nostr Connect session...');
      const nip46 = await loadNip46Module();
      const localSecretKey = window.NostrTools.generateSecretKey();
      const clientPubkey = window.NostrTools.getPublicKey(localSecretKey);
      const connectionSecret = getRandomSecret();
      const connectionUri = nip46.createNostrConnectURI({
        clientPubkey,
        relays,
        secret: connectionSecret,
        name: 'Ops Dashboard',
        url: window.location.origin,
      });

      amberRuntime = {
        pool: getSimplePool(),
        secretKey: localSecretKey,
        connectionUri,
        relays,
      };

      amberUri.value = connectionUri;
      eventJson.value = '';
      setAccessStage('auth');

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(connectionUri).catch(function() {});
      }

      setPreview('Opening Amber / Nostr Connect...');
      openExternalUri(connectionUri);
      setPreview('Approve the Amber request.');
      amberRuntime.signer = await nip46.BunkerSigner.fromURI(
        localSecretKey,
        connectionUri,
        { pool: amberRuntime.pool },
        180000,
      );

      const payload = buildPayload();
      const event = await buildSignedEventWithSigner(payload, amberRuntime.signer);
      client = new window.AccessWebRtcProxy({ signalTransport: createRelayTransport(amberRuntime.signer, event.pubkey, 'plain') });
      setPreview('Bootstrapping access...');
      await bootstrapWithEvent(client, event, payload);
    } catch (err) {
      setPreview(String(err && err.message ? err.message : err));
    } finally {
      await closeAmberRuntime(amberRuntime);
      amberRuntime = null;
    }
  });

  nsecBtn.addEventListener('click', async function() {
    try {
      const signer = createLocalSignerAdapterFromNsec(nsecValue.value);
      const payload = buildPayload();
      client = new window.AccessWebRtcProxy({ signalTransport: createRelayTransport(signer) });
      const event = buildWrappedEventWithNsec(payload, nsecValue.value);
      setPreview('Bootstrapping access...');
      await bootstrapWithEvent(client, event, payload);
    } catch (err) {
      setPreview(String(err && err.message ? err.message : err));
    }
  });

  bootstrapBtn.addEventListener('click', async function() {
    try {
      const parsed = JSON.parse(eventJson.value);
      client = new window.AccessWebRtcProxy();
      setPreview('Bootstrapping access...');
      await bootstrapWithEvent(client, parsed);
    } catch (err) {
      setPreview(String(err && err.message ? err.message : err));
    }
  });

  connectBtn.addEventListener('click', async function() {
    if (!client) return;
    try {
      setAccessStage('connecting');
      setPreview('Connecting WebRTC data channel...');
      await connectWithTimeout(client);
      setAccessStage('session');
      setPreview('Connected to access session ' + client.sessionId);
    } catch (err) {
      try {
        client.close();
      } catch {}
      setPreview('WebRTC unavailable, continuing with the authenticated dashboard...');
      setTimeout(navigateToNextUrl, 500);
    }
  });

  fetchBtn.addEventListener('click', async function() {
    if (!client) return;
    try {
      if (!client.connected) {
        await client.connect();
      }
      setAccessStage('session');
      setPreview('Fetching dashboard HTML through the data channel...');
      var response = await client.proxyFetch('/', { method: 'GET' });
      setPreview([
        'status: ' + response.status,
        'headers: ' + JSON.stringify(response.headers, null, 2),
        '',
        response.body.slice(0, 3000),
      ].join('\n'));
    } catch (err) {
      setPreview(String(err && err.message ? err.message : err));
    }
  });
})();
