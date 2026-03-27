const assert = require('assert');

function loadFreshModule() {
  delete require.cache[require.resolve('../src/deployment')];
  return require('../src/deployment');
}

describe('deployment config', function() {
  let oldAppHost;
  let oldBindHost;
  let oldPort;
  let oldBackendBaseUrl;

  beforeEach(function() {
    oldAppHost = process.env.APP_HOST;
    oldBindHost = process.env.BIND_HOST;
    oldPort = process.env.PORT;
    oldBackendBaseUrl = process.env.BACKEND_BASE_URL;
  });

  afterEach(function() {
    if (oldAppHost) process.env.APP_HOST = oldAppHost;
    else delete process.env.APP_HOST;
    if (oldBindHost) process.env.BIND_HOST = oldBindHost;
    else delete process.env.BIND_HOST;
    if (oldPort) process.env.PORT = oldPort;
    else delete process.env.PORT;
    if (oldBackendBaseUrl) process.env.BACKEND_BASE_URL = oldBackendBaseUrl;
    else delete process.env.BACKEND_BASE_URL;
  });

  it('defaults to loopback binding and local backend base url', function() {
    delete process.env.APP_HOST;
    delete process.env.BIND_HOST;
    delete process.env.PORT;
    delete process.env.BACKEND_BASE_URL;

    const deployment = loadFreshModule();

    assert.equal(deployment.resolveListenHost(), '127.0.0.1');
    assert.equal(deployment.resolveListenPort(), 4080);
    assert.equal(deployment.resolveBackendBaseUrl(), 'http://127.0.0.1:4080');
  });

  it('allows wireguard-specific overrides for the backend host and base url', function() {
    process.env.APP_HOST = '10.44.0.2';
    process.env.PORT = '4080';
    process.env.BACKEND_BASE_URL = 'http://10.44.0.2:4080';

    const deployment = loadFreshModule();

    assert.equal(deployment.resolveListenHost(), '10.44.0.2');
    assert.equal(deployment.resolveListenPort(), 4080);
    assert.equal(deployment.resolveBackendBaseUrl(), 'http://10.44.0.2:4080');
  });

  it('prefers BACKEND_BASE_URL when provided', function() {
    process.env.APP_HOST = '10.44.0.2';
    process.env.PORT = '4080';
    process.env.BACKEND_BASE_URL = 'http://10.44.0.2:5000';

    const deployment = loadFreshModule();

    assert.equal(deployment.resolveBackendBaseUrl(), 'http://10.44.0.2:5000');
  });
});
