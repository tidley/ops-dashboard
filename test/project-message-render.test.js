const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createNode(tagName) {
  const listeners = {};
  const classTokens = new Set();
  function matchesSelector(node, selector) {
    const value = String(selector || '').trim();
    if (!value) return false;
    if (value.startsWith('[') && value.endsWith(']')) {
      const attr = value.slice(1, -1).split('=')[0].trim();
      return Object.prototype.hasOwnProperty.call(node.attributes || {}, attr);
    }
    if (value.startsWith('.')) {
      const className = value.slice(1);
      return String(node.className || '').split(/\s+/).includes(className);
    }
    return String(node.tagName || '').toLowerCase() === value.toLowerCase();
  }

  function walk(node, selector, all, results) {
    if (matchesSelector(node, selector)) {
      if (!all) return node;
      results.push(node);
    }
    for (const child of node.children || []) {
      const found = walk(child, selector, all, results);
      if (found && !all) return found;
    }
    return all ? results : null;
  }

  const node = {
    tagName: String(tagName || '').toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    parentNode: null,
    open: false,
    style: {},
    classList: {
      add(token) {
        if (!token) return;
        classTokens.add(token);
        node.className = Array.from(classTokens).join(' ');
      },
      remove(token) {
        if (!token) return;
        classTokens.delete(token);
        node.className = Array.from(classTokens).join(' ');
      },
      contains(token) {
        return classTokens.has(token);
      },
      toggle(token, force) {
        if (force === true) {
          classTokens.add(token);
          node.className = Array.from(classTokens).join(' ');
          return true;
        }
        if (force === false) {
          classTokens.delete(token);
          node.className = Array.from(classTokens).join(' ');
          return false;
        }
        if (classTokens.has(token)) {
          classTokens.delete(token);
          node.className = Array.from(classTokens).join(' ');
          return false;
        }
        classTokens.add(token);
        node.className = Array.from(classTokens).join(' ');
        return true;
      },
    },
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
      if (child && typeof child === 'object') {
        child.parentNode = this;
      }
      this.children.push(child);
      return child;
    },
    closest(selector) {
      if (!selector) return null;
      var current = this;
      while (current) {
        if (selector === '[data-recent-file-item]' && current.attributes && current.attributes['data-recent-file-item'] !== undefined) {
          return current;
        }
        current = current.parentNode || null;
      }
      return null;
    },
    setAttribute(name, value) {
      const key = String(name);
      const text = String(value);
      this.attributes[key] = text;
      if (key === 'class') {
        this.className = text;
        classTokens.clear();
        text.split(/\s+/).filter(Boolean).forEach((token) => classTokens.add(token));
      }
    },
    getAttribute(name) {
      return this.attributes[name] || '';
    },
    querySelector() {
      return walk(this, arguments[0], false, []);
    },
    querySelectorAll() {
      return walk(this, arguments[0], true, []);
    },
  };
  return node;
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

    details.open = true;
    details.dispatchEvent({ type: 'toggle' });
    assert.equal(summary.textContent, 'show less');
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

  it('opens and closes the recent file detail drawer', function() {
    const harness = createHarness();
    const root = createNode('div');
    root.setAttribute('data-recent-files-root', 'true');
    const item = createNode('div');
    item.setAttribute('data-recent-file-item', 'true');
    item.setAttribute('data-status-label', 'Modified');
    item.setAttribute('data-file-name', 'app.js');
    item.setAttribute('data-file-path', 'src/app.js');
    item.setAttribute('data-file-updated-label', 'Mar 27, 2026, 17:12');
    item.setAttribute('data-file-updated-relative', '1m ago');
    item.setAttribute('data-file-summary', '+12 -3');
    const button = createNode('button');
    button.setAttribute('data-recent-file-trigger', 'true');
    button.setAttribute('aria-expanded', 'false');
    const detailPanel = createNode('div');
    detailPanel.setAttribute('class', 'recent-file-item__detail-panel');
    const detailPath = createNode('code');
    detailPath.setAttribute('class', 'recent-file-item__detail-path');
    detailPath.textContent = 'src/app.js';
    detailPanel.appendChild(detailPath);
    const detail = createNode('div');
    detail.setAttribute('data-recent-file-detail', 'true');
    detail.scrollHeight = 160;
    detail.appendChild(detailPanel);
    item.appendChild(button);
    item.appendChild(detail);
    root.appendChild(item);
    harness.document.body.appendChild(root);
    harness.document.querySelector = function(selector) {
      if (selector === '[data-recent-files-root]') return root;
      if (selector === '[data-recent-file-detail]') return detail;
      return null;
    };
    harness.document.querySelectorAll = function(selector) {
      if (selector === '[data-recent-file-item]') return [item];
      return [];
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
    api.openRecentFileDetail(button);

    assert.equal(item.classList.contains('is-selected'), true);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(detail.classList.contains('is-open'), true);
    assert.ok(findByClass(detail, 'recent-file-item__detail-panel'), 'expected a populated detail panel');
    assert.equal(findByClass(detail, 'recent-file-item__detail-path').textContent, 'src/app.js');

    api.closeRecentFileDetail();
    assert.equal(item.classList.contains('is-selected'), false);
    assert.equal(detail.classList.contains('is-open'), false);
  });
});
