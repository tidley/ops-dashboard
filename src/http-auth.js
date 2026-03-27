const AUTH_COOKIE_NAME = 'ops_access_session';
const PUBLIC_PATHS = [
  '/access',
  '/api/access/bootstrap',
  '/favicon.ico',
];
const PUBLIC_PREFIXES = [
  '/public/',
];

function nowMs() {
  return Date.now();
}

function isPathPublic(pathname = '') {
  const value = `${pathname || ''}`.split('?')[0];
  if (!value) return false;
  if (PUBLIC_PATHS.includes(value)) return true;
  if (/^\/api\/access\/sessions\/[^/]+\/confirm$/.test(value)) return true;
  return PUBLIC_PREFIXES.some(prefix => value.startsWith(prefix));
}

function parseCookiesHeader(header = '') {
  return `${header || ''}`.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index < 0) return acc;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function isAccessSessionActive(session) {
  if (!session) return false;
  if (session.state !== 'active') return false;
  if (session.revoked_at) return false;
  const expiresAt = new Date(session.expires_at || 0).getTime();
  if (!expiresAt || Number.isNaN(expiresAt)) return false;
  return nowMs() <= expiresAt;
}

function resolveAccessSessionId(req = {}) {
  if (req.cookies && req.cookies[AUTH_COOKIE_NAME]) return `${req.cookies[AUTH_COOKIE_NAME]}`.trim();
  const cookies = parseCookiesHeader(req.headers?.cookie || '');
  if (cookies[AUTH_COOKIE_NAME]) return `${cookies[AUTH_COOKIE_NAME]}`.trim();
  const header = `${req.get ? req.get('x-access-session') : req.headers?.['x-access-session'] || ''}`.trim();
  return header;
}

function buildUnauthenticatedResponse(req) {
  const acceptsHtml = `${req.accepts ? req.accepts('html') : ''}` === 'html'
    || `${req.get ? req.get('accept') : req.headers?.accept || ''}`.includes('text/html');

  if (acceptsHtml) {
    const nextUrl = encodeURIComponent(req.originalUrl || req.url || '/');
    return {
      kind: 'redirect',
      statusCode: 302,
      headers: {
        Location: `/access?next=${nextUrl}`,
      },
    };
  }

  return {
    kind: 'json',
    statusCode: 401,
    body: { error: 'authentication_required' },
  };
}

function createRequireAccess({ store }) {
  if (!store || typeof store.getAccessSession !== 'function') {
    throw new Error('store with getAccessSession is required');
  }

  return function requireAccess(req, res, next) {
    const pathname = req.path || req.originalUrl || req.url || '';
    if (isPathPublic(pathname)) return next();

    const sessionId = resolveAccessSessionId(req);
    const session = sessionId ? store.getAccessSession(sessionId) : null;
    if (!isAccessSessionActive(session)) {
      if (sessionId && session && typeof store.touchAccessSession === 'function') {
        store.touchAccessSession(sessionId, {
          state: session.state === 'active' ? 'expired' : session.state,
          last_seen_at: new Date().toISOString(),
        });
      }

      if (typeof res.clearCookie === 'function') {
        res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      }

      const unauth = buildUnauthenticatedResponse(req);
      if (unauth.kind === 'redirect') {
        return res.redirect(unauth.statusCode, unauth.headers.Location);
      }
      return res.status(unauth.statusCode).json(unauth.body);
    }

    req.accessSession = session;
    return next();
  };
}

function accessCookieOptions(req = {}) {
  const secure = Boolean(req.secure || `${req.get ? req.get('x-forwarded-proto') : req.headers?.['x-forwarded-proto'] || ''}`.toLowerCase().includes('https'));
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 10 * 60 * 1000,
  };
}

function buildAccessCookieValue(sessionId) {
  return `${sessionId || ''}`.trim();
}

module.exports = {
  AUTH_COOKIE_NAME,
  accessCookieOptions,
  buildAccessCookieValue,
  buildUnauthenticatedResponse,
  createRequireAccess,
  isAccessSessionActive,
  isPathPublic,
  parseCookiesHeader,
  resolveAccessSessionId,
};
