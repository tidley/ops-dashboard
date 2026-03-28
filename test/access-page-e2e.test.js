const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement(id) {
  const classNames = new Set();
  return {
    id,
    value: '',
    textContent: '',
    disabled: false,
    hidden: false,
    style: {},
    rel: '',
    href: '',
    classList: {
      add(...tokens) {
        tokens.forEach(token => {
          if (token) classNames.add(token);
        });
      },
      remove(...tokens) {
        tokens.forEach(token => classNames.delete(token));
      },
      toggle(token, force) {
        if (force === true) {
          classNames.add(token);
          return true;
        }
        if (force === false) {
          classNames.delete(token);
          return false;
        }
        if (classNames.has(token)) {
          classNames.delete(token);
          return false;
        }
        classNames.add(token);
        return true;
      },
      contains(token) {
        return classNames.has(token);
      },
    },
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    async click() {
      if (typeof this.listeners.click === 'function') {
        return this.listeners.click({ preventDefault() {} });
      }
      return undefined;
    },
    remove() {},
  };
}

function createFakeBrowserHarness() {
  const ids = [
    'signer_tab',
    'nip07_tab',
    'amber_tab',
    'nsec_tab',
    'nip07_login_btn',
    'amber_login_btn',
    'nsec_login_btn',
    'connect_btn',
    'fetch_btn',
    'session_stage',
    'auth_prompt',
    'nsec_value',
    'client_status',
    'server_status',
    'session_id',
    'signal_url',
    'proxy_url',
    'signer_panel',
    'nip07_panel',
    'amber_panel',
    'nsec_panel',
  ];

  const elements = new Map(ids.map(id => [id, createElement(id)]));
  const document = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement(tag) {
      return createElement(tag);
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
  };

  let clipboardValue = '';
  let navigationTarget = '';
  let uuidCounter = 0;
  const window = {
    ACCESS_GATEWAY: {
      app: 'ops-dashboard.access.v1',
      gatewayPubkey: 'gateway-pubkey-test',
      gatewayNpub: 'npub1gatewaypubkeytest',
    },
    FIPS_STUN_URL: 'stun:fips.example:3478',
    crypto: {
      randomUUID() {
        uuidCounter += 1;
        return `uuid-${uuidCounter}`;
      },
    },
    NostrTools: {
      nip19: {
        decode(raw) {
          return { type: 'nsec', data: raw.replace(/^nsec:/, '') };
        },
      },
      getPublicKey(secretKey) {
        return `pub-${secretKey}`;
      },
      finalizeEvent(event, secretKey) {
        return {
          ...event,
          pubkey: `pub-${secretKey}`,
          id: `signed-${secretKey}-${event.kind}`,
          sig: `sig-${secretKey}`,
        };
      },
      nip44: {
        getConversationKey(secretKey, recipientPubkey) {
          return `conv:${secretKey}:${recipientPubkey}`;
        },
        encrypt(plaintext, conversationKey) {
          return `enc:${conversationKey}:${plaintext}`;
        },
        decrypt(payload, conversationKey) {
          const prefix = `enc:${conversationKey}:`;
          assert.ok(payload.startsWith(prefix), 'expected payload encrypted for the conversation');
          return payload.slice(prefix.length);
        },
      },
      SimplePool: class FakePool {
        constructor() {
          this.published = [];
          this.subscriptions = [];
        }

        subscribe(relays, filter, handlers) {
          this.subscriptions.push({ relays, filter, handlers });
          return {
            close() {},
          };
        }

        publish(relays, event) {
          this.published.push({ relays, event });
          return [Promise.resolve(true)];
        }
      },
    },
    nostr: {
      async getPublicKey() {
        return 'pub-browser-nip07';
      },
      async signEvent(event) {
        return {
          ...event,
          pubkey: 'pub-browser-nip07',
          id: `nip07-${event.kind}`,
          sig: 'nip07-sig',
        };
      },
    nip44: {
      async encrypt(recipientPubkey, plaintext) {
          throw new Error('nip44_encrypt_should_not_be_used_for_nip07');
      },
      async decrypt(senderPubkey, payload) {
          throw new Error('nip44_decrypt_should_not_be_used_for_nip07');
      },
    },
    },
    navigator: {
      clipboard: {
        async writeText(value) {
          clipboardValue = value;
        },
      },
    },
    location: {
      search: '?next=%2F',
      href: '',
      assign(value) {
        navigationTarget = value;
        this.href = value;
      },
    },
    document,
    setTimeout,
    clearTimeout,
    console,
    JSON,
    Promise,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
  };
  window.window = window;
  window.document = document;
  window.navigator = window.navigator;

  return {
    window,
    document,
    elements,
    getClipboard: () => clipboardValue,
    getNavigationTarget: () => navigationTarget,
  };
}

describe('access page e2e', function() {
  it('boots relay transport and auto-connects after NIP-07 sign in', async function() {
    const harness = createFakeBrowserHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/access-page.js'), 'utf8');

    class FakeAccessWebRtcProxy {
      static instances = [];

      constructor(options = {}) {
        this.signalTransport = options.signalTransport || null;
        this.bootstrapCalls = [];
        this.connectCalls = 0;
        this.connected = false;
        FakeAccessWebRtcProxy.instances.push(this);
      }

      async bootstrap(bootstrapUrl, bootstrapEvent, bootstrapMeta = {}) {
        this.bootstrapCalls.push({ bootstrapUrl, bootstrapEvent, bootstrapMeta });
        return {
          ok: true,
          session_id: bootstrapMeta.payload.session_id,
          signal_url: `/api/access/sessions/${bootstrapMeta.payload.session_id}/signal`,
          proxy_url: `/api/access/sessions/${bootstrapMeta.payload.session_id}/proxy`,
        };
      }

      async connect() {
        this.connectCalls += 1;
        this.connected = true;
        return this;
      }

      close() {}
    }

    const context = vm.createContext({
      ...harness.window,
      AccessWebRtcProxy: FakeAccessWebRtcProxy,
    });
    context.window = context;
    context.document = harness.document;
    context.navigator = harness.window.navigator;
    context.crypto = harness.window.crypto;
    context.AccessWebRtcProxy = FakeAccessWebRtcProxy;
    context.FIPS_STUN_URL = harness.window.FIPS_STUN_URL;

    vm.runInContext(script, context, { filename: 'access-page.js' });

    assert.equal(harness.document.getElementById('signer_panel').hidden, false);
    assert.equal(harness.document.getElementById('nip07_panel').hidden, false);
    assert.equal(harness.document.getElementById('amber_panel').hidden, true);
    assert.equal(harness.document.getElementById('nsec_panel').hidden, true);

    const nip07LoginBtn = harness.document.getElementById('nip07_login_btn');
    const clickPromise = nip07LoginBtn.click();
    assert.equal(nip07LoginBtn.disabled, true, 'expected the login button to disable immediately after click');
    assert.equal(harness.document.getElementById('signer_tab').disabled, true, 'expected the outer tab to disable immediately after click');
    assert.equal(harness.document.getElementById('nip07_tab').disabled, true, 'expected the NIP-07 tab to disable immediately after click');
    assert.equal(harness.document.getElementById('amber_tab').disabled, true, 'expected the Amber tab to disable immediately after click');
    assert.equal(harness.document.getElementById('nsec_tab').disabled, true, 'expected the nsec tab to disable immediately after click');
    assert.equal(harness.document.getElementById('amber_login_btn').disabled, true, 'expected the Amber login button to disable immediately after click');
    assert.equal(harness.document.getElementById('nsec_login_btn').disabled, true, 'expected the nsec login button to disable immediately after click');
    await clickPromise;

    const instance = FakeAccessWebRtcProxy.instances[0];
    assert.ok(instance, 'expected the access page to construct a WebRTC proxy');
    assert.ok(instance.signalTransport, 'expected a relay signal transport');
    assert.equal(instance.signalTransport.constructor.name, 'RelaySignalTransport');
    assert.equal(
      JSON.stringify(instance.signalTransport.relays),
      JSON.stringify([
        'wss://relay.damus.io',
        'wss://relay.primal.net',
        'wss://relay.nostr.band',
        'wss://relay.snort.social',
        'wss://nos.lol',
        'wss://nostr.mom',
      ]),
    );
    assert.equal(instance.bootstrapCalls.length, 1, 'expected bootstrap to run once');
    assert.equal(instance.bootstrapCalls[0].bootstrapMeta.payload.transport, 'webrtc-direct');
    assert.equal(
      JSON.stringify(instance.bootstrapCalls[0].bootstrapMeta.payload.relay_urls),
      JSON.stringify([
        'wss://relay.damus.io',
        'wss://relay.primal.net',
        'wss://relay.nostr.band',
        'wss://relay.snort.social',
        'wss://nos.lol',
        'wss://nostr.mom',
      ]),
    );
    assert.equal(instance.bootstrapCalls[0].bootstrapEvent.pubkey, 'pub-browser-nip07');
    assert.equal(instance.connectCalls, 1, 'expected the page to auto-connect after bootstrap');
    assert.equal(harness.document.getElementById('session_stage').hidden, false);
    assert.match(harness.document.getElementById('session_id').textContent, /^acc-/);
    assert.equal(harness.document.getElementById('fetch_btn').disabled, false);
    await new Promise(resolve => setTimeout(resolve, 2800));
    assert.match(harness.document.getElementById('client_status').textContent, /Connected to access session/);
    assert.match(harness.document.getElementById('server_status').textContent, /Session active\./);
  });

  it('switches to the relevant fields for each sign-in tab', async function() {
    const harness = createFakeBrowserHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/access-page.js'), 'utf8');

    const context = vm.createContext({
      ...harness.window,
      AccessWebRtcProxy: class {},
    });
    context.window = context;
    context.document = harness.document;
    context.navigator = harness.window.navigator;
    context.crypto = harness.window.crypto;
    context.AccessWebRtcProxy = class {};
    context.FIPS_STUN_URL = harness.window.FIPS_STUN_URL;

    vm.runInContext(script, context, { filename: 'access-page.js' });

    assert.equal(harness.document.getElementById('signer_panel').hidden, false);
    assert.equal(harness.document.getElementById('nip07_panel').hidden, false);
    assert.equal(harness.document.getElementById('amber_panel').hidden, true);
    assert.equal(harness.document.getElementById('nsec_panel').hidden, true);
    assert.equal(harness.document.getElementById('auth_prompt').textContent, 'Select signer');

    await harness.document.getElementById('amber_tab').click();
    assert.equal(harness.document.getElementById('signer_panel').hidden, false);
    assert.equal(harness.document.getElementById('nip07_panel').hidden, true);
    assert.equal(harness.document.getElementById('amber_panel').hidden, false);
    assert.equal(harness.document.getElementById('nsec_panel').hidden, true);
    assert.equal(harness.document.getElementById('auth_prompt').textContent, 'Select signer');

    await harness.document.getElementById('nsec_tab').click();
    assert.equal(harness.document.getElementById('signer_panel').hidden, true);
    assert.equal(harness.document.getElementById('amber_panel').hidden, true);
    assert.equal(harness.document.getElementById('nsec_panel').hidden, false);
    assert.equal(harness.document.getElementById('auth_prompt').textContent, 'Enter nsec');
  });

  it('falls back to the authenticated dashboard when WebRTC connect fails', async function() {
    const harness = createFakeBrowserHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/access-page.js'), 'utf8');

    class FailingAccessWebRtcProxy {
      constructor(options = {}) {
        this.signalTransport = options.signalTransport || null;
        this.bootstrapCalls = [];
        this.connectCalls = 0;
        this.connected = false;
      }

      async bootstrap(bootstrapUrl, bootstrapEvent, bootstrapMeta = {}) {
        this.bootstrapCalls.push({ bootstrapUrl, bootstrapEvent, bootstrapMeta });
        return {
          ok: true,
          session: {
            id: bootstrapMeta.payload.session_id,
          },
          signal_url: `/api/access/sessions/${bootstrapMeta.payload.session_id}/signal`,
          proxy_url: `/api/access/sessions/${bootstrapMeta.payload.session_id}/proxy`,
        };
      }

      async connect() {
        this.connectCalls += 1;
        throw new Error('ice_failed');
      }

      close() {}
    }

    const context = vm.createContext({
      ...harness.window,
      AccessWebRtcProxy: FailingAccessWebRtcProxy,
    });
    context.window = context;
    context.document = harness.document;
    context.navigator = harness.window.navigator;
    context.crypto = harness.window.crypto;
    context.AccessWebRtcProxy = FailingAccessWebRtcProxy;
    context.FIPS_STUN_URL = harness.window.FIPS_STUN_URL;

    vm.runInContext(script, context, { filename: 'access-page.js' });

    await harness.document.getElementById('nip07_login_btn').click();
    await new Promise(resolve => setTimeout(resolve, 2800));

    assert.equal(harness.getNavigationTarget(), '/');
    assert.match(harness.document.getElementById('client_status').textContent, /WebRTC unavailable/i);
  });
});
