(function() {
  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
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

  function getIceServers() {
    if (Array.isArray(window.FIPS_ICE_SERVERS) && window.FIPS_ICE_SERVERS.length) {
      return window.FIPS_ICE_SERVERS;
    }
    const stun = window.FIPS_STUN_URL || 'stun:fips.tomdwyer.uk:3478';
    return [{ urls: [stun] }];
  }

  class AccessWebRtcProxy {
    constructor({ sessionId, signalUrl, proxyUrl, signalTransport } = {}) {
      this.sessionId = sessionId || '';
      this.signalUrl = signalUrl || '';
      this.proxyUrl = proxyUrl || '';
      this.signalTransport = signalTransport || null;
      this.pc = null;
      this.channel = null;
      this.pending = new Map();
      this.connectPromise = null;
      this.channelOpenPromise = null;
      this.connected = false;
      this.pendingCandidates = [];
    }

    async bootstrap(bootstrapUrl, bootstrapEvent, bootstrapMeta = {}) {
      if (this.signalTransport && typeof this.signalTransport.bootstrap === 'function') {
        const json = await this.signalTransport.bootstrap(bootstrapEvent, bootstrapMeta);
        this.sessionId = json.session?.id || json.session_id || this.sessionId;
        this.signalUrl = json.signal_url || this.signalUrl;
        this.proxyUrl = json.proxy_url || this.proxyUrl;
        return json;
      }

      const res = await fetch(bootstrapUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event: bootstrapEvent }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `bootstrap_failed:${res.status}`);
      }
      this.sessionId = json.session.id;
      this.signalUrl = json.signal_url;
      this.proxyUrl = json.proxy_url;
      return json;
    }

    async connect() {
      if (!this.sessionId || !this.signalUrl) {
        throw new Error('missing_session_or_signal_url');
      }
      if (this.connectPromise) return this.connectPromise;

      this.connectPromise = this._connect();
      return this.connectPromise;
    }

    async _connect() {
      this.pc = new RTCPeerConnection({ iceServers: getIceServers() });
      this.channel = this.pc.createDataChannel('ops-dashboard', { ordered: true });

      this.channelOpenPromise = new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          fn(value);
        };

        this.channel.onopen = () => {
          this.connected = true;
          finish(resolve, this);
        };

        this.channel.onerror = (event) => {
          const error = event instanceof Error ? event : new Error('channel_error');
          finish(reject, error);
        };

        this.channel.onclose = () => {
          this.connected = false;
          if (!settled) finish(reject, new Error('channel_closed'));
        };
      });

      this.channel.onmessage = (event) => {
        const frame = parseJson(event.data, {});
        if (!frame || typeof frame !== 'object') return;
        const pending = this.pending.get(frame.request_id);
        if (!pending) return;
        this.pending.delete(frame.request_id);
        if (frame.error) {
          pending.reject(new Error(frame.error));
          return;
        }
        pending.resolve(frame.response || frame);
      };

      this.pc.onicecandidate = async (event) => {
        if (!event.candidate) return;
        await this.signal({ type: 'ice', candidate: event.candidate });
      };

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const answer = await this.signal({ type: 'offer', sdp: offer });
      if (answer?.sdp) {
        await this.pc.setRemoteDescription(answer.sdp);
      }

      if (Array.isArray(answer?.candidates)) {
        for (const candidate of answer.candidates) {
          try {
            await this.pc.addIceCandidate(candidate);
          } catch {
            // ignore individual candidate failures
          }
        }
      }

      return this.channelOpenPromise;
    }

    async signal(signal) {
      if (this.signalTransport && typeof this.signalTransport.signal === 'function') {
        const json = await this.signalTransport.signal(signal);
        if (json?.session?.id) this.sessionId = json.session.id;
        if (json?.signal_url) this.signalUrl = json.signal_url;
        if (json?.proxy_url) this.proxyUrl = json.proxy_url;
        return json;
      }

      const res = await fetch(this.signalUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(signal),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `signal_failed:${res.status}`);
      }
      return json;
    }

    async proxyFetch(path, init = {}) {
      if (!this.connected || !this.channel || this.channel.readyState !== 'open') {
        throw new Error('proxy_not_connected');
      }

      const requestId = randomId();
      const request = {
        request_id: requestId,
        method: `${init.method || 'GET'}`.toUpperCase(),
        path,
        headers: init.headers || {},
        body: Object.prototype.hasOwnProperty.call(init, 'body') ? init.body : undefined,
      };

      const responsePromise = new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject });
        setTimeout(() => {
          if (!this.pending.has(requestId)) return;
          this.pending.delete(requestId);
          reject(new Error('proxy_timeout'));
        }, 15000);
      });

      this.channel.send(JSON.stringify({ type: 'http_request', request }));
      return responsePromise;
    }

    close() {
      this.connected = false;
      this.pending.forEach(({ reject }) => reject(new Error('proxy_closed')));
      this.pending.clear();
      if (this.channel) {
        try { this.channel.close(); } catch {}
      }
      if (this.pc) {
        try { this.pc.close(); } catch {}
      }
      this.channel = null;
      this.pc = null;
      this.connectPromise = null;
    }
  }

  window.AccessWebRtcProxy = AccessWebRtcProxy;
})();
