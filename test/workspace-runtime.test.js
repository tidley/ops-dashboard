const assert = require('assert');
const childProcess = require('child_process');

describe('workspace runtime', function() {
  let originalSpawn;

  beforeEach(function() {
    originalSpawn = childProcess.spawn;
  });

  afterEach(function() {
    childProcess.spawn = originalSpawn;
    delete require.cache[require.resolve('../src/workspace-runtime')];
    delete process.env.PORT;
  });

  it('does not leak the dashboard PORT env into code-server launches', function() {
    let captured = null;
    process.env.PORT = '1717';
    childProcess.spawn = function(command, args, options) {
      captured = { command, args, options };
      return {
        pid: 1234,
        unref() {},
      };
    };

    delete require.cache[require.resolve('../src/workspace-runtime')];
    const { launchCodeServer } = require('../src/workspace-runtime');
    launchCodeServer({
      projectId: 'proj-test',
      projectName: 'Port Env Test',
      workspacePath: '/tmp/port-env-test',
      port: 18361,
      proxyBase: '/workspace/proj-test',
    });

    assert.ok(captured);
    assert.equal(captured.command, process.env.CODE_SERVER_BIN || 'code-server');
    assert.equal(captured.args[0], '--bind-addr');
    assert.equal(captured.args[1], '127.0.0.1:18361');
    assert.equal(captured.args[2], '--user-data-dir');
    assert.match(captured.args[3], /\/\.local\/share\/vibez-workspaces\/port-env-test-j-test\/user-data$/);
    assert.equal(captured.args[4], '--extensions-dir');
    assert.match(captured.args[5], /\/\.local\/share\/code-server\/extensions$/);
    assert.equal(captured.args[6], '--cookie-suffix');
    assert.equal(captured.args[7], 'proj-test');
    assert.equal(captured.args[8], '--abs-proxy-base-path');
    assert.equal(captured.args[9], '/workspace/proj-test');
    assert.equal(captured.args[10], '--ignore-last-opened');
    assert.equal(captured.args[11], '/tmp/port-env-test');
    assert.equal(Object.prototype.hasOwnProperty.call(captured.options.env, 'PORT'), false);
  });
});
