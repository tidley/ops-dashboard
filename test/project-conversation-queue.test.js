const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function matchesSelector(node, selector) {
  const value = String(selector || '').trim();
  if (!value) return false;

  if (value.startsWith('.')) {
    const className = value.slice(1);
    return String(node.className || '').split(/\s+/).filter(Boolean).includes(className);
  }

  if (value.startsWith('#')) {
    return `${node.id || ''}` === value.slice(1);
  }

  const attrMatch = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) {
    const attrName = attrMatch[1];
    const attrValue = attrMatch[2];
    const nodeValue = node.getAttribute ? node.getAttribute(attrName) : '';
    return typeof attrValue === 'string' ? nodeValue === attrValue : nodeValue !== '';
  }

  const tagAttrMatch = value.match(/^([a-z0-9-]+)\[([^=\]]+)(?:="([^"]*)")?\]$/i);
  if (tagAttrMatch) {
    const tagName = tagAttrMatch[1].toLowerCase();
    const attrName = tagAttrMatch[2];
    const attrValue = tagAttrMatch[3];
    if (String(node.tagName || '').toLowerCase() !== tagName) return false;
    const nodeValue = node.getAttribute ? node.getAttribute(attrName) : '';
    return typeof attrValue === 'string' ? nodeValue === attrValue : nodeValue !== '';
  }

  return String(node.tagName || '').toLowerCase() === value.toLowerCase();
}

function walk(node, selector, results) {
  if (!node) return;
  if (matchesSelector(node, selector)) results.push(node);
  (node.children || []).forEach((child) => walk(child, selector, results));
}

function createNode(tagName) {
  const listeners = {};
  const node = {
    tagName: String(tagName || '').toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    parentNode: null,
    scrollTop: 0,
    scrollHeight: 0,
    id: '',
    name: '',
    value: '',
    type: '',
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
      if (child) {
        child.parentNode = this;
        this.children.push(child);
      }
      return child;
    },
    replaceChild(newChild, oldChild) {
      const index = this.children.indexOf(oldChild);
      if (index < 0) return null;
      if (newChild) {
        newChild.parentNode = this;
        this.children[index] = newChild;
      } else {
        this.children.splice(index, 1);
      }
      if (oldChild) oldChild.parentNode = null;
      return oldChild;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index < 0) return null;
      this.children.splice(index, 1);
      if (child) child.parentNode = null;
      return child;
    },
    setAttribute(name, value) {
      const key = String(name);
      const text = String(value);
      this.attributes[key] = text;
      if (key === 'id') this.id = text;
      if (key === 'name') this.name = text;
      if (key === 'value') this.value = text;
      if (key === 'type') this.type = text;
      if (key === 'class') this.className = text;
    },
    getAttribute(name) {
      const key = String(name);
      if (Object.prototype.hasOwnProperty.call(this.attributes, key)) return this.attributes[key];
      if (key === 'id') return this.id || '';
      if (key === 'name') return this.name || '';
      if (key === 'value') return this.value || '';
      if (key === 'type') return this.type || '';
      if (key === 'class') return this.className || '';
      return '';
    },
    querySelector(selector) {
      const results = [];
      walk(this, selector, results);
      return results[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      walk(this, selector, results);
      return results;
    },
    matches(selector) {
      return matchesSelector(this, selector);
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (matchesSelector(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    },
  };

  Object.defineProperty(node, 'innerHTML', {
    get() {
      return this._innerHTML || '';
    },
    set(value) {
      this._innerHTML = String(value);
      this.children.forEach((child) => {
        if (child) child.parentNode = null;
      });
      this.children = [];
    },
  });

  Object.defineProperty(node, 'firstChild', {
    get() {
      return this.children[0] || null;
    },
  });

  return node;
}

function createHarness() {
  const body = createNode('body');
  body.classList = {
    toggle() {},
    contains() { return false; },
  };
  body.setAttribute('data-project-id', 'proj-test');
  body.setAttribute('data-active-tab', 'conversations');

  const thread = createNode('div');
  thread.className = 'chat-thread';
  const form = createNode('form');
  form.id = 'message_form';

  const sessionInput = createNode('input');
  sessionInput.setAttribute('type', 'hidden');
  sessionInput.setAttribute('id', 'session_id');
  sessionInput.setAttribute('name', 'session_id');
  sessionInput.value = '';

  const agentInput = createNode('input');
  agentInput.setAttribute('type', 'hidden');
  agentInput.setAttribute('name', 'agent_id');
  agentInput.value = 'agent-openclaw-main';

  const priorityInput = createNode('input');
  priorityInput.setAttribute('type', 'hidden');
  priorityInput.setAttribute('name', 'priority');
  priorityInput.value = 'normal';

  const textarea = createNode('textarea');
  textarea.setAttribute('id', 'text');
  textarea.setAttribute('name', 'text');
  textarea.value = '';

  const promptButton = createNode('button');
  promptButton.setAttribute('type', 'submit');
  promptButton.setAttribute('name', 'message_type');
  promptButton.setAttribute('value', 'prompt');
  promptButton.textContent = 'Send';

  const continueButton = createNode('button');
  continueButton.setAttribute('type', 'submit');
  continueButton.setAttribute('name', 'message_type');
  continueButton.setAttribute('value', 'continue');
  continueButton.textContent = 'Continue';

  const summariseButton = createNode('button');
  summariseButton.setAttribute('type', 'submit');
  summariseButton.setAttribute('name', 'message_type');
  summariseButton.setAttribute('value', 'summarise');
  summariseButton.textContent = 'Summarise';

  form.fields = [sessionInput, agentInput, priorityInput, textarea];
  form.appendChild(sessionInput);
  form.appendChild(agentInput);
  form.appendChild(priorityInput);
  form.appendChild(textarea);
  form.appendChild(promptButton);
  form.appendChild(continueButton);
  form.appendChild(summariseButton);

  body.appendChild(thread);
  body.appendChild(form);

  const document = {
    body,
    readyState: 'complete',
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
    getElementById(id) {
      return id === 'message_form' ? form : null;
    },
    createElement: createNode,
  };

  class FakeFormData {
    constructor(targetForm) {
      this.entriesList = [];
      const fields = Array.isArray(targetForm?.fields) ? targetForm.fields : [];
      fields.forEach((field) => {
        if (!field || !field.name) return;
        this.entriesList.push([field.name, field.value || '']);
      });
    }

    [Symbol.iterator]() {
      return this.entriesList[Symbol.iterator]();
    }
  }

  const fetchCalls = [];
  const pendingResponses = [];

  function fakeFetch(url, options) {
    const entry = { url, options };
    fetchCalls.push(entry);
    return new Promise((resolve) => {
      pendingResponses.push({ entry, resolve });
    });
  }

  const window = {
    document,
    history: {
      pushState() {},
      replaceState() {},
    },
    location: {
      origin: 'http://localhost',
      href: 'http://localhost/project/proj-test?tab=conversations',
      search: '?tab=conversations',
      assign() {},
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout(fn) {
      return 1;
    },
    clearTimeout() {},
    fetch: fakeFetch,
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
    URLSearchParams,
    FormData: FakeFormData,
  };

  window.window = window;
  return { window, document, form, textarea, promptButton, fetchCalls, pendingResponses, thread };
}

function loadProjectPage(window, document) {
  const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/project-page.js'), 'utf8');
  const context = vm.createContext({
    ...window,
  });
  context.window = context;
  context.document = document;
  context.history = window.history;
  context.location = window.location;
  context.addEventListener = window.addEventListener;
  context.removeEventListener = window.removeEventListener;
  vm.runInContext(script, context, { filename: 'project-page.js' });
  return context.OpsDashboardProjectPage;
}

function collectTextsByClass(node, className, acc = []) {
  if (!node) return acc;
  const classes = String(node.className || '').split(/\s+/).filter(Boolean);
  if (classes.includes(className)) {
    acc.push(node.textContent || '');
  }
  (node.children || []).forEach((child) => collectTextsByClass(child, className, acc));
  return acc;
}

async function waitFor(condition, timeoutMs = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('project conversation queue', function() {
  it('queues additional sends and preserves their text until each request is sent', async function() {
    const harness = createHarness();
    const api = loadProjectPage(harness.window, harness.document);

    assert.ok(api, 'expected project page helpers');

    harness.textarea.value = 'First queued message';
    api.submitMessage(harness.form, harness.promptButton);

    const generatedSessionId = harness.form.querySelector('#session_id').value;
    assert.match(generatedSessionId, /^ses-/);

    harness.textarea.value = 'Second queued message';
    api.submitMessage(harness.form, harness.promptButton);

    assert.equal(harness.fetchCalls.length, 1);
    assert.match(harness.fetchCalls[0].options.body, /text=First\+queued\+message/);
    assert.match(harness.fetchCalls[0].options.body, new RegExp(`session_id=${generatedSessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(harness.thread.children.length, 2);
    assert.deepStrictEqual(
      collectTextsByClass(harness.thread, 'chat-bubble__body').filter(Boolean).slice(0, 2),
      ['First queued message', 'Second queued message']
    );

    harness.pendingResponses.shift().resolve({
      json: async () => ({
        success: true,
        session_id: generatedSessionId,
        messages: [
          {
            id: 'msg-first-out',
            direction: 'outbound',
            message_type: 'prompt',
            content: 'First queued message',
            created_at: '2026-03-27T14:00:00.000Z',
          },
          {
            id: 'msg-first-in',
            direction: 'inbound',
            message_type: 'prompt',
            content: 'First reply',
            created_at: '2026-03-27T14:00:02.000Z',
          },
        ],
      }),
    });

    await waitFor(() => harness.fetchCalls.length >= 2);

    assert.ok(harness.fetchCalls.length >= 2);
    assert.match(harness.fetchCalls[1].options.body, /text=Second\+queued\+message/);
    assert.match(harness.fetchCalls[1].options.body, new RegExp(`session_id=${generatedSessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(harness.thread.children.length >= 3, true);
    assert.deepStrictEqual(
      collectTextsByClass(harness.thread, 'chat-bubble__body').filter(Boolean).slice(0, 3),
      ['First queued message', 'First reply', 'Second queued message']
    );

    harness.pendingResponses.shift().resolve({
      json: async () => ({
        success: true,
        session_id: generatedSessionId,
        messages: [
          {
            id: 'msg-first-out',
            direction: 'outbound',
            message_type: 'prompt',
            content: 'First queued message',
            created_at: '2026-03-27T14:00:00.000Z',
          },
          {
            id: 'msg-first-in',
            direction: 'inbound',
            message_type: 'prompt',
            content: 'First reply',
            created_at: '2026-03-27T14:00:02.000Z',
          },
          {
            id: 'msg-second-out',
            direction: 'outbound',
            message_type: 'prompt',
            content: 'Second queued message',
            created_at: '2026-03-27T14:00:05.000Z',
          },
          {
            id: 'msg-second-in',
            direction: 'inbound',
            message_type: 'prompt',
            content: 'Second reply',
            created_at: '2026-03-27T14:00:08.000Z',
          },
        ],
      }),
    });

    await waitFor(() => collectTextsByClass(harness.thread, 'chat-bubble__body').some((text) => text === 'Second reply'));

    assert.ok(harness.fetchCalls.length >= 2);
    assert.deepStrictEqual(
      collectTextsByClass(harness.thread, 'chat-bubble__body').filter(Boolean).slice(0, 4),
      ['First queued message', 'First reply', 'Second queued message', 'Second reply']
    );
  });
});
