const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createNode(tagName) {
  const listeners = {};
  return {
    tagName: String(tagName || '').toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    open: false,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners[(event && event.type) || ''] || [];
      handlers.forEach((handler) => handler.call(this, event));
      return true;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] || '';
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function createHarness() {
  const body = createNode('body');
  body.classList = {
    toggle() {},
    contains() { return false; },
  };

  const document = {
    body,
    createElement: createNode,
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };

  const window = {
    document,
    history: {
      pushState() {},
      replaceState() {},
    },
    location: {
      origin: 'http://localhost',
      href: 'http://localhost/project/proj-test',
      search: '',
      assign() {},
    },
    addEventListener() {},
    removeEventListener() {},
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
    URL,
    FormData,
  };

  window.window = window;
  return { window, document };
}

function findByClass(node, className) {
  if (!node) return null;
  const classes = String(node.className || '').split(/\s+/).filter(Boolean);
  if (classes.includes(className)) return node;
  for (const child of node.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function findByTag(node, tagName) {
  if (!node) return null;
  if (String(node.tagName || '').toLowerCase() === String(tagName || '').toLowerCase()) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findByTag(child, tagName);
    if (found) return found;
  }
  return null;
}

describe('project message render', function() {
  it('truncates long messages and adds a collapsed error section', function() {
    const harness = createHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/project-page.js'), 'utf8');
    const context = vm.createContext({
      ...harness.window,
    });
    context.window = context;
    context.document = harness.document;
    context.history = harness.window.history;
    context.location = harness.window.location;
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const api = context.OpsDashboardProjectPage;
    assert.ok(api, 'expected project page helpers to be exported');

    const longText = 'x'.repeat(2600);
    const node = api.createMessageNode({
      direction: 'outbound',
      content: longText,
      created_at: '2026-03-27T14:00:00.000Z',
    });

    const bubble = findByClass(node, 'chat-bubble');
    const preview = findByClass(node, 'chat-bubble__body--preview');
    const details = findByClass(node, 'chat-bubble__details--message');
    const full = findByClass(node, 'chat-bubble__body--full');
    const summary = findByTag(details, 'summary');

    assert.ok(bubble, 'expected a bubble');
    assert.ok(preview, 'expected a preview body');
    assert.equal(preview.textContent.endsWith('...'), true);
    assert.ok(details, 'expected a collapsed details section');
    assert.equal(summary.textContent, 'show more');
    assert.equal(full.textContent, longText);
  });

  it('keeps error text collapsed under the bubble', function() {
    const harness = createHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/project-page.js'), 'utf8');
    const context = vm.createContext({
      ...harness.window,
    });
    context.window = context;
    context.document = harness.document;
    context.history = harness.window.history;
    context.location = harness.window.location;
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const api = context.OpsDashboardProjectPage;
    const node = api.createMessageNode({
      direction: 'inbound',
      content: 'Reply text',
      error_text: 'OpenClaw unavailable',
      created_at: '2026-03-27T14:00:00.000Z',
    });

    const errorDetails = findByClass(node, 'chat-bubble__details--error');
    const errorBlock = findByClass(node, 'chat-bubble__error');
    const summary = findByTag(errorDetails, 'summary');

    assert.ok(errorDetails, 'expected an error expander');
    assert.equal(summary.textContent, 'show error');
    assert.equal(errorBlock.textContent, 'OpenClaw unavailable');

    errorDetails.open = true;
    errorDetails.dispatchEvent({ type: 'toggle' });
    assert.equal(summary.textContent, 'hide error');
  });

  it('scrolls the conversation thread to the bottom', function() {
    const harness = createHarness();
    const thread = createNode('div');
    thread.scrollHeight = 1337;
    thread.scrollTop = 0;
    harness.document.querySelector = function(selector) {
      return selector === '.chat-thread' ? thread : null;
    };

    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/project-page.js'), 'utf8');
    const context = vm.createContext({
      ...harness.window,
    });
    context.window = context;
    context.document = harness.document;
    context.history = harness.window.history;
    context.location = harness.window.location;
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const api = context.OpsDashboardProjectPage;
    assert.ok(api, 'expected project page helpers to be exported');

    api.scrollThreadToBottom();

    assert.equal(thread.scrollTop, 1337);
  });
});
