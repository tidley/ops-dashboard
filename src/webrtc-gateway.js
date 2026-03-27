const { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = require('@roamhq/wrtc');
const { getAccessSession, touchAccessSession } = require('./store');
const { AUTH_COOKIE_NAME } = require('./http-auth');

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

function isAccessSessionActive(session) {
  if (!session) return false;
  if (session.state === 'revoked') return false;
  const expiresAt = new Date(session.expires_at || 0).getTime();
  if (!expiresAt || Number.isNaN(expiresAt)) return false;
  return Date.now() <= expiresAt;
}

function normaliseSignal(signal) {
  if (!signal || typeof signal !== 'object') {
    return { ok: false, error: 'invalid_signal' };
  }

  const type = `${signal.type || ''}`.trim();
  if (!type) return { ok: false, error: 'missing_signal_type' };

  return {
    ok: true,
    signal: {
      ...signal,
      type,
    },
  };
}

class WebRtcGateway {
  constructor({ store, baseUrl = 'http://127.0.0.1:4080', iceServers = [] } = {}) {
    this.store = store;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.iceServers = iceServers.length
      ? iceServers
      : [{ urls: [process.env.FIPS_STUN_URL || 'stun:fips.tomdwyer.uk:3478'] }];
    this.sessions = new Map();
  }

  getSessionState(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  ensureSession(accessSessionId) {
    const accessSession = getAccessSession(accessSessionId);
    if (!accessSession) {
      return { ok: false, error: 'access_session_not_found' };
    }
    if (!isAccessSessionActive(accessSession)) {
      return { ok: false, error: 'access_session_inactive' };
    }

    const existing = this.sessions.get(accessSessionId);
    if (existing) {
      existing.accessSession = accessSession;
      return { ok: true, session: existing };
    }

    const session = {
      id: accessSessionId,
      accessSession,
      pc: null,
      dataChannel: null,
      pendingSignals: [],
      pendingRequests: new Map(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.sessions.set(accessSessionId, session);
    return { ok: true, session };
  }

  closeSession(accessSessionId, reason = 'closed') {
    const session = this.sessions.get(accessSessionId);
    if (!session) return false;

    if (session.dataChannel) {
      try { session.dataChannel.close(); } catch {}
    }
    if (session.pc) {
      try { session.pc.close(); } catch {}
    }
    this.sessions.delete(accessSessionId);
    if (this.store) {
      touchAccessSession(accessSessionId, {
        state: 'closed',
        last_seen_at: nowIso(),
        metadata: { close_reason: reason },
      });
    }
    return true;
  }

  drainSignals(session) {
    const signals = session.pendingSignals.slice();
    session.pendingSignals.length = 0;
    return signals;
  }

  queueSignal(session, signal) {
    session.pendingSignals.push(signal);
    session.updatedAt = nowIso();
  }

  createPeer(session) {
    if (session.pc) return session.pc;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    session.pc = pc;

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.queueSignal(session, { type: 'ice', candidate: event.candidate });
      if (session.accessSession) {
        touchAccessSession(session.id, {
          last_seen_at: nowIso(),
          state: 'active',
        });
      }
    };

    pc.ondatachannel = (event) => {
      session.dataChannel = event.channel;
      this.attachChannel(session, event.channel);
    };

    pc.onconnectionstatechange = () => {
      if (!session.accessSession) return;
      const state = pc.connectionState;
      if (state === 'connected') {
        touchAccessSession(session.id, {
          state: 'active',
          last_seen_at: nowIso(),
        });
      }
      if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        touchAccessSession(session.id, {
          state,
          last_seen_at: nowIso(),
        });
      }
    };

    return pc;
  }

  attachChannel(session, channel) {
    channel.onopen = () => {
      session.dataChannel = channel;
      touchAccessSession(session.id, {
        state: 'active',
        last_seen_at: nowIso(),
      });
    };

    channel.onmessage = async (event) => {
      let frame;
      try {
        frame = parseJson(event.data, {});
      } catch {
        return;
      }

      if (!frame || typeof frame !== 'object') return;
      if (frame.type === 'http_request') {
        const response = await this.proxyHttpRequest(session.id, frame.request || {});
        this.sendFrame(session, response);
      }
    };

    channel.onclose = () => {
      touchAccessSession(session.id, {
        state: 'closed',
        last_seen_at: nowIso(),
      });
    };
  }

  sendFrame(session, frame) {
    if (!session.dataChannel || session.dataChannel.readyState !== 'open') return false;
    session.dataChannel.send(JSON.stringify(frame));
    return true;
  }

  async proxyHttpRequest(accessSessionId, request = {}) {
    const session = this.sessions.get(accessSessionId);
    if (!session) {
      return {
        type: 'http_response',
        request_id: request.request_id || '',
        error: 'session_not_ready',
      };
    }

    const method = `${request.method || 'GET'}`.toUpperCase();
    const path = `${request.path || '/'}`.trim();
    if (!path.startsWith('/') || path.startsWith('//')) {
      return {
        type: 'http_response',
        request_id: request.request_id || '',
        error: 'invalid_path',
      };
    }

    const headers = new Headers();
    const requestHeaders = parseJson(request.headers, request.headers || {});
    if (requestHeaders && typeof requestHeaders === 'object') {
      for (const [key, value] of Object.entries(requestHeaders)) {
        if (value != null) headers.set(key, `${value}`);
      }
    }
    if (session.accessSession?.id) {
      headers.set('cookie', `${AUTH_COOKIE_NAME}=${session.accessSession.id}`);
      headers.set('x-access-session', session.accessSession.id);
    }

    const body = Object.prototype.hasOwnProperty.call(request, 'body') ? request.body : undefined;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : body,
    });

    const text = await response.text();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      type: 'http_response',
      request_id: request.request_id || '',
      response: {
        status: response.status,
        ok: response.ok,
        headers: responseHeaders,
        body: text,
      },
    };
  }

  async handleSignal(accessSessionId, rawSignal) {
    const normalized = normaliseSignal(rawSignal);
    if (!normalized.ok) return { ok: false, error: normalized.error };

    const sessionCheck = this.ensureSession(accessSessionId);
    if (!sessionCheck.ok) return sessionCheck;
    const session = sessionCheck.session;
    const pc = this.createPeer(session);

    const signal = normalized.signal;
    try {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        return {
          ok: true,
          type: 'answer',
          sdp: pc.localDescription,
          candidates: this.drainSignals(session),
        };
      }

      if (signal.type === 'ice') {
        if (signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
        return {
          ok: true,
          type: 'ice',
          candidates: this.drainSignals(session),
        };
      }

      if (signal.type === 'close') {
        this.closeSession(accessSessionId, signal.reason || 'client_closed');
        return { ok: true, closed: true };
      }

      return { ok: false, error: 'unsupported_signal_type' };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  }
}

module.exports = {
  WebRtcGateway,
  isAccessSessionActive,
  normaliseSignal,
};
