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

  const FIXED_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://relay.nostr.band',
    'wss://relay.snort.social',
    'wss://nos.lol',
    'wss://nostr.mom',
  ];

  function setText(el, value) {
    if (el) el.textContent = value;
  }

  var STATUS_MIN_INTERVAL_MS = 750;

  function setButtonBusy(button, isBusy) {
    if (!button) return;
    button.disabled = Boolean(isBusy);
    if (button.classList && typeof button.classList.toggle === 'function') {
      button.classList.toggle('is-busy', Boolean(isBusy));
    }
    if (typeof button.setAttribute === 'function') {
      if (isBusy) {
        button.setAttribute('aria-busy', 'true');
      } else {
        button.removeAttribute('aria-busy');
      }
    }
  }

  function createStatusQueueState() {
    return {
      client: {
        queue: [],
        timer: null,
        idleTimer: null,
        lastChangeAt: 0,
      },
      server: {
        queue: [],
        timer: null,
        idleTimer: null,
        lastChangeAt: 0,
      },
    };
  }

  var statusState = createStatusQueueState();
  var statusPanels = {
    client: null,
    server: null,
  };

  function getStatusEl(lane) {
    return lane === 'server' ? statusPanels.server : statusPanels.client;
  }

  function setStatusLive(lane, isLive) {
    var el = getStatusEl(lane);
    if (!el) return;
    el.classList.toggle('is-live', Boolean(isLive));
  }

  function setStatusText(lane, value) {
    var el = getStatusEl(lane);
    if (!el) return;
    el.textContent = value;
  }

  var accessErrorEl = null;

  function setAccessError(message, kind) {
    if (!accessErrorEl) return;
    var text = String(message || '').trim();
    accessErrorEl.textContent = text;
    accessErrorEl.hidden = !text;
    if (accessErrorEl.classList && typeof accessErrorEl.classList.toggle === 'function') {
      accessErrorEl.classList.toggle('is-notice', kind === 'notice' && Boolean(text));
    }
    if (typeof accessErrorEl.setAttribute === 'function') {
      accessErrorEl.setAttribute('role', kind === 'notice' ? 'status' : 'alert');
      accessErrorEl.setAttribute('aria-live', kind === 'notice' ? 'polite' : 'assertive');
    } else {
      accessErrorEl.role = kind === 'notice' ? 'status' : 'alert';
      accessErrorEl.ariaLive = kind === 'notice' ? 'polite' : 'assertive';
    }
  }

  function formatLoginError(err, fallback) {
    var raw = String(err && err.message ? err.message : err || '').trim();
    var normalized = raw || fallback || 'authentication_failed';
    if (normalized === 'relay_signal_timeout') return 'Timed out waiting for gateway response.';
    if (normalized === 'relay_transport_closed') return 'Relay transport closed before the handshake completed.';
    if (normalized === 'webrtc_connect_timeout') return 'WebRTC connection timed out.';
    if (normalized === 'missing_session_id') return 'Gateway did not return a session id.';
    if (normalized === 'bootstrap_rejected') return 'Gateway rejected the login request.';
    if (normalized.indexOf('bootstrap_reject:') === 0) return normalized.slice('bootstrap_reject:'.length).trim() || 'Gateway rejected the login request.';
    if (normalized.indexOf('confirm_failed:') === 0) return normalized.slice('confirm_failed:'.length).trim() || 'Session cookie confirmation failed.';
    if (/^HTTP \d+$/i.test(normalized)) return `Gateway returned ${normalized}.`;
    return normalized.replace(/_/g, ' ');
  }

  var startupStepEls = {
    prepare: null,
    sign: null,
    publish: null,
    verify: null,
    issue: null,
    cookie: null,
    connect: null,
    session: null,
  };

  var startupStepState = {
    current: null,
    queue: [],
    timer: null,
    lastChangeAt: 0,
  };

  var STARTUP_STEP_MIN_INTERVAL_MS = 750;

  function clearStartupStepTimer() {
    if (startupStepState.timer) {
      clearTimeout(startupStepState.timer);
      startupStepState.timer = null;
    }
  }

  function applyStartupStep(step) {
    var state = startupStepState;
    var nextStep = step || null;
    var currentStep = state.current;
    if (currentStep && currentStep !== nextStep) {
      var currentEl = startupStepEls[currentStep];
      if (currentEl && currentEl.classList && typeof currentEl.classList.remove === 'function') {
        currentEl.classList.add('is-complete');
        currentEl.classList.remove('is-current');
      }
    }

    state.current = nextStep;
    state.lastChangeAt = Date.now();

    if (!nextStep) return;
    var el = startupStepEls[nextStep];
    if (!el || !el.classList || typeof el.classList.add !== 'function') return;
    el.classList.add('is-current');
  }

  function pumpStartupStepQueue() {
    var state = startupStepState;
    if (state.timer) return;
    if (!state.queue.length) return;

    var delay = Math.max(
      0,
      STARTUP_STEP_MIN_INTERVAL_MS - (Date.now() - state.lastChangeAt),
    );

    state.timer = setTimeout(function() {
      state.timer = null;
      if (!state.queue.length) return;
      applyStartupStep(state.queue.shift());
      pumpStartupStepQueue();
    }, delay);
  }

  function setStartupStepCurrent(step) {
    var state = startupStepState;
    var nextStep = step || null;
    if (!nextStep) return;
    if (state.current === nextStep) return;
    if (state.queue.indexOf(nextStep) !== -1) return;
    state.queue.push(nextStep);
    pumpStartupStepQueue();
  }

  function setStartupStepComplete(step) {
    var el = startupStepEls[step];
    if (!el || !el.classList || typeof el.classList.add !== 'function') return;
    el.classList.add('is-complete');
    if (startupStepState.current === step) {
      startupStepState.current = null;
      el.classList.remove('is-current');
    }
  }

  function clearStatusTimers(lane) {
    var state = statusState[lane];
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  function primeStatusLane(lane, value) {
    var state = statusState[lane];
    if (!state) return;
    clearStatusTimers(lane);
    state.queue.length = 0;
    state.lastChangeAt = Date.now();
    setStatusText(lane, value);
    setStatusLive(lane, true);
    state.idleTimer = setTimeout(function() {
      var activeState = statusState[lane];
      if (!activeState || activeState.queue.length || activeState.timer) return;
      setStatusLive(lane, false);
      activeState.idleTimer = null;
    }, STATUS_MIN_INTERVAL_MS);
  }

  function pumpStatusLane(lane) {
    var state = statusState[lane];
    if (!state || state.timer) return;
    if (!state.queue.length) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      state.idleTimer = setTimeout(function() {
        var activeState = statusState[lane];
        if (!activeState || activeState.queue.length || activeState.timer) return;
        setStatusLive(lane, false);
        activeState.idleTimer = null;
      }, STATUS_MIN_INTERVAL_MS);
      return;
    }

    var delay = Math.max(
      0,
      STATUS_MIN_INTERVAL_MS - (Date.now() - state.lastChangeAt),
    );

    state.timer = setTimeout(function() {
      var activeState = statusState[lane];
      if (!activeState) return;
      activeState.timer = null;
      if (!activeState.queue.length) {
        pumpStatusLane(lane);
        return;
      }

      var nextValue = activeState.queue.shift();
      setStatusText(lane, nextValue);
      setStatusLive(lane, true);
      activeState.lastChangeAt = Date.now();
      pumpStatusLane(lane);
    }, delay);
  }

  function queueStatus(lane, value) {
    var state = statusState[lane];
    if (!state || !getStatusEl(lane)) return;
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    state.queue.push(String(value || ''));
    setStatusLive(lane, true);
    pumpStatusLane(lane);
  }

  function updateLoginBorder(isActive) {
    if (!document.body || !document.body.classList) return;
    document.body.classList.toggle('access-login-pending', Boolean(isActive));
  }

  function startGlowCycle() {
    if (!document || typeof document.querySelectorAll !== 'function') return;
    const nodes = Array.prototype.slice.call(
      document.querySelectorAll('.access-brand__node'),
    );
    if (!nodes.length || window.__accessGlowTimer) return;

    function setActiveNode(index) {
      nodes.forEach(function (node, nodeIndex) {
        node.classList.toggle('is-active', nodeIndex === index);
      });
    }

    var currentIndex = Math.floor(Math.random() * nodes.length);
    var scheduleNext = function() {
      window.__accessGlowTimer = setTimeout(function() {
        if (!nodes.length) return;
        var nextIndex = Math.floor(Math.random() * nodes.length);
        if (nodes.length > 1 && nextIndex === currentIndex) {
          nextIndex = (nextIndex + 1) % nodes.length;
        }
        currentIndex = nextIndex;
        setActiveNode(currentIndex);
        scheduleNext();
      }, 640 + Math.floor(Math.random() * 560));
    };

    setActiveNode(currentIndex);
    scheduleNext();
  }

  function setLoginGlow(isActive) {
    updateLoginBorder(isActive);
    startGlowCycle();
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

  function currentRelayUrls() {
    return FIXED_RELAYS.slice();
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
    return '/';
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
    if (!result || result.ok === false || result.type === 'bootstrap_reject') {
      throw new Error(result && (result.error || result.reason) ? `${result.error || result.reason}` : 'bootstrap_rejected');
    }
    const sessionId =
      `${(result && result.session && result.session.id) || result.session_id || client.sessionId || ''}`.trim();
    const signalUrl =
      `${result && result.signal_url ? result.signal_url : ''}`.trim();
    const proxyUrl =
      `${result && result.proxy_url ? result.proxy_url : ''}`.trim();
    if (!sessionId) throw new Error('missing_session_id');

    if (client && !client.sessionId) {
      client.sessionId = sessionId;
    }

    setStartupStepComplete('issue');
    setStartupStepCurrent('cookie');
    setText(sessionIdEl, sessionId);
    setText(signalUrlEl, signalUrl || '(pending)');
    setText(proxyUrlEl, proxyUrl || '(pending)');
    queueStatus('server', 'Gateway issued session ' + sessionId + '.');
    if (result.bootstrap_cookie_token) {
      try {
        queueStatus('client', 'Confirming session cookie...');
        await confirmSessionCookie(sessionId, result.bootstrap_cookie_token);
      } catch (err) {
        const message = formatLoginError(err, 'Session cookie confirmation failed.');
        setAccessError('Authentication failed: ' + message);
        primeStatusLane('client', message);
        primeStatusLane('server', message);
        throw err;
      }
    }
    setAccessStage('connecting');
    setStartupStepComplete('cookie');
    setStartupStepCurrent('connect');
    setStartupStepComplete('connect');
    queueStatus('client', 'Connecting WebRTC data channel...');
    try {
      await connectWithTimeout(client);
      setLoginGlow(false);
      setAccessError('');
      setStartupStepComplete('session');
      setStartupStepCurrent('session');
      setAccessStage('session');
      queueStatus('client', 'Connected to access session ' + client.sessionId);
      queueStatus('server', 'Session active.');
    } catch (err) {
      try {
        client.close();
      } catch {}
      setLoginGlow(false);
      setStartupStepComplete('session');
      setStartupStepCurrent('session');
      const message = formatLoginError(err, 'WebRTC unavailable.');
      setAccessError('WebRTC unavailable, continuing with the authenticated dashboard.', 'notice');
      primeStatusLane('client', 'WebRTC unavailable, continuing with the authenticated dashboard...');
      primeStatusLane('server', message);
      setTimeout(navigateToNextUrl, 1200);
    }
    return result;
  }

  function setPreview(value) {
    queueStatus('client', value);
  }

  function setServerPreview(value) {
    queueStatus('server', value);
  }

  var nip07LoginBtn = qs('nip07_login_btn');
  var signerTab = qs('signer_tab');
  var amberTab = qs('amber_tab');
  var nsecTab = qs('nsec_tab');
  var nip07Tab = qs('nip07_tab');
  var nsecBtn = qs('nsec_login_btn');
  var connectBtn = qs('connect_btn');
  var fetchBtn = qs('fetch_btn');
  var amberLoginBtn = qs('amber_login_btn');
  var nsecValue = qs('nsec_value');
  var clientStatus = qs('client_status');
  var serverStatus = qs('server_status');
  statusPanels.client = clientStatus;
  statusPanels.server = serverStatus;
  startupStepEls.prepare = qs('startup_step_prepare');
  startupStepEls.sign = qs('startup_step_sign');
  startupStepEls.publish = qs('startup_step_publish');
  startupStepEls.verify = qs('startup_step_verify');
  startupStepEls.issue = qs('startup_step_issue');
  startupStepEls.cookie = qs('startup_step_cookie');
  startupStepEls.connect = qs('startup_step_connect');
  startupStepEls.session = qs('startup_step_session');
  var sessionIdEl = qs('session_id');
  var signalUrlEl = qs('signal_url');
  var proxyUrlEl = qs('proxy_url');
  var sessionMeta = qs('session_meta');
  var authPrompt = qs('auth_prompt');
  var signerPanel = qs('signer_panel');
  var nip07Panel = qs('nip07_panel');
  var amberPanel = qs('amber_panel');
  var nsecPanel = qs('nsec_panel');
  var authButtons = [
    signerTab,
    nip07Tab,
    amberTab,
    nsecTab,
    nip07LoginBtn,
    amberLoginBtn,
    nsecBtn,
  ].filter(Boolean);
  var authMode = 'signer';
  var signerMethod = 'nip07';
  var sessionStage = qs('session_stage');
  accessErrorEl = qs('access_error');
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
    if (signerPanel) signerPanel.hidden = mode !== 'signer';
    if (nsecPanel) nsecPanel.hidden = mode !== 'nsec';
    if (mode !== 'signer') {
      if (nip07Panel) nip07Panel.hidden = true;
      if (amberPanel) amberPanel.hidden = true;
    } else {
      setSignerMethod(signerMethod || 'nip07');
    }
    setTabActive(signerTab, mode === 'signer');
    setTabActive(nsecTab, mode === 'nsec');
  }

  function setSignerMethod(method) {
    signerMethod = method;
    if (nip07Panel) nip07Panel.hidden = method !== 'nip07';
    if (amberPanel) amberPanel.hidden = method !== 'amber';
    setTabActive(nip07Tab, method === 'nip07');
    setTabActive(amberTab, method === 'amber');
  }

  function setAuthPrompt(mode) {
    if (!authPrompt) return;
    authPrompt.textContent = mode === 'signer' ? 'Select signer' : 'Enter nsec';
  }

  function setAuthButtonsBusy(isBusy) {
    authButtons.forEach(function (button) {
      setButtonBusy(button, isBusy);
    });
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
  setAuthMode('signer');
  setSignerMethod('nip07');
  setAuthPrompt('signer');
  setAccessError('');
  setStatusText('client', 'Waiting for sign in…');
  setStatusText('server', 'Waiting for bootstrap request…');
  setStatusLive('client', false);
  setStatusLive('server', false);
  startGlowCycle();
  clearSessionFields();

  signerTab.addEventListener('click', function () {
    setAuthMode('signer');
    setAuthPrompt('signer');
  });

  nsecTab.addEventListener('click', function () {
    setAuthMode('nsec');
    setAuthPrompt('nsec');
  });

  nip07Tab.addEventListener('click', function() {
    setAuthMode('signer');
    setAuthPrompt('signer');
    setSignerMethod('nip07');
  });

  amberTab.addEventListener('click', function() {
    setAuthMode('signer');
    setAuthPrompt('signer');
    setSignerMethod('amber');
  });

  nip07LoginBtn.addEventListener('click', async function (event) {
    const button =
      event && event.currentTarget ? event.currentTarget : nip07LoginBtn;
    setAuthButtonsBusy(true);
    setLoginGlow(true);
    setAccessError('');
    setStartupStepCurrent('prepare');
    try {
      setAccessStage('auth');
      primeStatusLane('client', 'Waiting for NIP-07 approval...');
      primeStatusLane('server', 'Waiting for bootstrap request...');
      const payload = buildPayload();
      const signedEvent = await buildSignedEventWithNip07(payload);
      setStartupStepComplete('sign');
      setStartupStepCurrent('publish');
      const signalTransport = createRelayTransport(
        window.nostr,
        signedEvent.pubkey,
        'plain',
      );
      client = new window.AccessWebRtcProxy({ signalTransport });
      queueStatus('client', 'Bootstrapping access via Nostr...');
      queueStatus('server', 'Gateway verifying signed bootstrap request...');
      setStartupStepCurrent('verify');
      await bootstrapWithEvent(client, signedEvent, payload);
    } catch (err) {
      const message = formatLoginError(err, 'Authentication failed.');
      setAccessError('Authentication failed: ' + message);
      primeStatusLane('client', message);
      primeStatusLane('server', message);
      setAuthButtonsBusy(false);
      setLoginGlow(false);
    }
  });

  amberLoginBtn.addEventListener('click', async function (event) {
    const button =
      event && event.currentTarget ? event.currentTarget : amberLoginBtn;
    setAuthButtonsBusy(true);
    setLoginGlow(true);
    setAccessError('');
    setStartupStepCurrent('prepare');
    try {
      await closeAmberRuntime(amberRuntime);
      amberRuntime = null;
      if (
        !window.NostrTools ||
        typeof window.NostrTools.generateSecretKey !== 'function' ||
        typeof window.NostrTools.getPublicKey !== 'function'
      ) {
        throw new Error('nostr_tools_unavailable');
      }

      primeStatusLane('client', 'Preparing Amber session...');
      primeStatusLane('server', 'Waiting for bootstrap request...');
      const nip46 = await loadNip46Module();
      const localSecretKey = window.NostrTools.generateSecretKey();
      const clientPubkey = window.NostrTools.getPublicKey(localSecretKey);
      const connectionSecret = getRandomSecret();
      const relays = currentRelayUrls();
      const connectionUri = nip46.createNostrConnectURI({
        clientPubkey,
        relays,
        secret: connectionSecret,
        name: 'vibez',
        url: window.location.origin,
      });

      amberRuntime = {
        pool: getSimplePool(),
        secretKey: localSecretKey,
        connectionUri,
        relays,
      };

      setAccessStage('auth');

      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        navigator.clipboard.writeText(connectionUri).catch(function () {});
      }

      queueStatus('client', 'Opening Amber...');
      openExternalUri(connectionUri);
      queueStatus('client', 'Approve the Amber request.');
      amberRuntime.signer = await nip46.BunkerSigner.fromURI(
        localSecretKey,
        connectionUri,
        { pool: amberRuntime.pool },
        180000,
      );

      const payload = buildPayload();
      const signedEvent = await buildSignedEventWithSigner(
        payload,
        amberRuntime.signer,
      );
      setStartupStepComplete('sign');
      setStartupStepCurrent('publish');
      client = new window.AccessWebRtcProxy({
        signalTransport: createRelayTransport(
          amberRuntime.signer,
          signedEvent.pubkey,
          'plain',
        ),
      });
      queueStatus('client', 'Bootstrapping access via Nostr...');
      queueStatus('server', 'Gateway verifying signed bootstrap request...');
      setStartupStepCurrent('verify');
      await bootstrapWithEvent(client, signedEvent, payload);
    } catch (err) {
      const message = formatLoginError(err, 'Authentication failed.');
      setAccessError('Authentication failed: ' + message);
      primeStatusLane('client', message);
      primeStatusLane('server', message);
      setAuthButtonsBusy(false);
      setLoginGlow(false);
    } finally {
      setLoginGlow(false);
      await closeAmberRuntime(amberRuntime);
      amberRuntime = null;
    }
  });

  nsecBtn.addEventListener('click', async function (event) {
    const button = event && event.currentTarget ? event.currentTarget : nsecBtn;
    setAuthButtonsBusy(true);
    setLoginGlow(true);
    setAccessError('');
    setStartupStepCurrent('prepare');
    try {
      primeStatusLane('client', 'Preparing local signing...');
      primeStatusLane('server', 'Waiting for bootstrap request...');
      const signer = createLocalSignerAdapterFromNsec(nsecValue.value);
      const payload = buildPayload();
      client = new window.AccessWebRtcProxy({
        signalTransport: createRelayTransport(signer),
      });
      const wrappedEvent = buildWrappedEventWithNsec(payload, nsecValue.value);
      setStartupStepComplete('sign');
      setStartupStepCurrent('publish');
      queueStatus('client', 'Bootstrapping access via Nostr...');
      queueStatus('server', 'Gateway verifying signed bootstrap request...');
      setStartupStepCurrent('verify');
      await bootstrapWithEvent(client, wrappedEvent, payload);
    } catch (err) {
      const message = formatLoginError(err, 'Authentication failed.');
      setAccessError('Authentication failed: ' + message);
      primeStatusLane('client', message);
      primeStatusLane('server', message);
      setAuthButtonsBusy(false);
      setLoginGlow(false);
    }
  });

  connectBtn.addEventListener('click', async function() {
    if (!client) return;
    try {
      setAccessError('');
      setAccessStage('connecting');
      queueStatus('client', 'Connecting WebRTC data channel...');
      await connectWithTimeout(client);
      setAccessStage('session');
      queueStatus('client', 'Connected to access session ' + client.sessionId);
    } catch (err) {
      try {
        client.close();
      } catch {}
      const message = formatLoginError(err, 'WebRTC unavailable.');
      setAccessError('WebRTC unavailable, continuing with the authenticated dashboard.', 'notice');
      primeStatusLane('client', 'WebRTC unavailable, continuing with the authenticated dashboard...');
      primeStatusLane('server', message);
      setTimeout(navigateToNextUrl, 1200);
    }
  });

  fetchBtn.addEventListener('click', async function() {
    if (!client) return;
    try {
      setAccessError('');
      if (!client.connected) {
        await client.connect();
      }
      setAccessStage('session');
      queueStatus('client', 'Fetching dashboard HTML through the data channel...');
      var response = await client.proxyFetch('/', { method: 'GET' });
      queueStatus('client', [
        'status: ' + response.status,
        'headers: ' + JSON.stringify(response.headers, null, 2),
        '',
        response.body.slice(0, 3000),
      ].join('\n'));
    } catch (err) {
      const message = formatLoginError(err, 'Connection failed.');
      setAccessError('Connection failed: ' + message);
      primeStatusLane('client', message);
      primeStatusLane('server', message);
    }
  });
})();
