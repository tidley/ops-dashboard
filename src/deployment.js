function parsePort(value, fallback) {
  const parsed = Number.parseInt(`${value || ''}`.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function resolveListenHost() {
  return `${process.env.APP_HOST || process.env.BIND_HOST || '127.0.0.1'}`.trim() || '127.0.0.1';
}

function resolveListenPort() {
  return parsePort(process.env.PORT, 4080);
}

function resolveBackendBaseUrl() {
  const baseUrl = `${process.env.BACKEND_BASE_URL || ''}`.trim();
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  return `http://${resolveListenHost()}:${resolveListenPort()}`;
}

function getDeploymentTopology() {
  return {
    publicEdge: {
      hostnames: ['ops.tomdwyer.uk'],
      port: 443,
      machine: 'cPanel redirector',
      role: 'forward-to-vps',
    },
    vpsAccessLayer: {
      hostnames: ['access.tomdwyer.uk'],
      ports: [443, 51820],
      wireGuardIp: '10.44.0.1',
      machine: 'VPS',
      services: ['nginx', 'wireguard', 'access-forwarder'],
      role: 'public-landing-and-http-forwarding',
    },
    backend: {
      hostnames: ['dashboard.private'],
      ports: [4080, 51820],
      wireGuardIp: '10.44.0.2',
      machine: 'dashboard host',
      services: ['ops-dashboard', 'websocket/webrtc gateway'],
      role: 'auth-signaling-and-dashboard-runtime',
    },
  };
}

module.exports = {
  getDeploymentTopology,
  parsePort,
  resolveBackendBaseUrl,
  resolveListenHost,
  resolveListenPort,
};
