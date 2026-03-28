const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function splitClasses(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function matchesSimpleSelector(node, selector) {
  const value = String(selector || '').trim();
  if (!value) return false;

  if (value === '.tabs a') {
    return node.tagName === 'A' && node.closest && !!node.closest('.tabs');
  }

  if (value === '.brand a') {
    return node.tagName === 'A' && node.closest && !!node.closest('.brand');
  }

  if (value === '.project-item__link') {
    return splitClasses(node.className).includes('project-item__link');
  }

  if (value.startsWith('.')) {
    return splitClasses(node.className).includes(value.slice(1));
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const attr = value.slice(1, -1).split('=')[0].trim();
    return Object.prototype.hasOwnProperty.call(node.attributes || {}, attr);
  }

  return String(node.tagName || '').toLowerCase() === value.toLowerCase();
}

function matchesSelector(node, selector) {
  return String(selector || '')
    .split(',')
    .some((part) => matchesSimpleSelector(node, part.trim()));
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
    id: '',
    value: '',
    style: {},
    setAttribute(name, value) {
      const key = String(name);
      const text = String(value);
      this.attributes[key] = text;
      if (key === 'class') this.className = text;
      if (key === 'id') this.id = text;
      if (key === 'value') this.value = text;
    },
    getAttribute(name) {
      const key = String(name);
      if (Object.prototype.hasOwnProperty.call(this.attributes, key)) return this.attributes[key];
      if (key === 'class') return this.className || '';
      if (key === 'id') return this.id || '';
      if (key === 'value') return this.value || '';
      return '';
    },
    appendChild(child) {
      if (child) {
        child.parentNode = this;
        this.children.push(child);
      }
      return child;
    },
    replaceWith(nextNode) {
      if (!this.parentNode) return;
      const parent = this.parentNode;
      const index = parent.children.indexOf(this);
      if (index >= 0) {
        parent.children[index] = nextNode;
        nextNode.parentNode = parent;
      }
      this.parentNode = null;
    },
    cloneNode(deep) {
      const clone = createNode(this.tagName);
      clone.className = this.className;
      clone.textContent = this.textContent;
      clone.attributes = { ...this.attributes };
      clone.id = this.id;
      clone.value = this.value;
      clone.style = { ...this.style };
      if (deep) {
        this.children.forEach((child) => {
          clone.appendChild(child.cloneNode ? child.cloneNode(true) : child);
        });
      }
      return clone;
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
    closest(selector) {
      let current = this;
      while (current) {
        if (matchesSelector(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    },
    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      const walk = (current) => {
        if (!current) return;
        if (matchesSelector(current, selector)) results.push(current);
        (current.children || []).forEach(walk);
      };
      (this.children || []).forEach(walk);
      return results;
    },
  };
  return node;
}

function buildDoc(kind) {
  const body = createNode('body');
  const shell = createNode('div');
  shell.className = 'shell';
  body.appendChild(shell);

  if (kind === 'home') {
    const projectLink = createNode('a');
    projectLink.className = 'project-item__link';
    projectLink.setAttribute('href', '/project/proj-2');
    shell.appendChild(projectLink);
  } else if (kind === 'project') {
    body.setAttribute('data-project-id', 'proj-2');
    body.setAttribute('data-active-tab', 'overview');

    const brand = createNode('div');
    brand.className = 'brand';
    const homeLink = createNode('a');
    homeLink.setAttribute('href', '/');
    brand.appendChild(homeLink);
    shell.appendChild(brand);
  }

  return {
    body,
    querySelector(selector) {
      return body.querySelector(selector);
    },
  };
}

function createHarness() {
  const homeDoc = buildDoc('home');
  const projectDoc = buildDoc('project');
  const homeShell = homeDoc.querySelector('.shell');

  const body = createNode('body');
  body.setAttribute('data-page', 'home');
  body.classList = {
    toggle() {},
    contains() { return false; },
  };

  const shell = homeShell.cloneNode(true);
  body.appendChild(shell);

  const listeners = {};
  const fetchCalls = [];
  const historyCalls = [];
  const urlByResponse = new Map([
    ['/project/proj-2', projectDoc],
    ['/', homeDoc],
  ]);

  const document = {
    body,
    readyState: 'complete',
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    querySelector(selector) {
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
    getElementById() {
      return null;
    },
    dispatchEvent(event) {
      const handlers = listeners[(event && event.type) || ''] || [];
      handlers.forEach((handler) => handler.call(document, event));
    },
  };

  const window = {
    document,
    history: {
      pushState(_state, _title, url) {
        historyCalls.push({ type: 'push', url });
      },
      replaceState(_state, _title, url) {
        historyCalls.push({ type: 'replace', url });
      },
    },
    location: {
      origin: 'http://localhost',
      href: 'http://localhost/',
      search: '',
    },
    addEventListener() {},
    removeEventListener() {},
    clearTimeout() {},
    setTimeout() { return 1; },
    fetch(url) {
      fetchCalls.push(url);
      const nextDoc = urlByResponse.get(new URL(url, window.location.origin).pathname);
      if (!nextDoc) {
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(urlByResponse.get(new URL(url, window.location.origin).pathname) === projectDoc ? 'project' : 'home'),
      });
    },
    DOMParser: class {
      parseFromString(html) {
        return html === 'project' ? projectDoc : homeDoc;
      }
    },
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
  };

  window.window = window;
  return { window, document, fetchCalls, historyCalls, body, homeDoc, projectDoc };
}

describe('project page navigation', function() {
  it('swaps the home page and project pages in place', async function() {
    const harness = createHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/project-page.js'), 'utf8');
    const context = vm.createContext({
      ...harness.window,
    });
    context.window = context;
    context.document = harness.document;
    context.history = harness.window.history;
    context.location = harness.window.location;
    context.fetch = harness.window.fetch;
    context.DOMParser = harness.window.DOMParser;
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    context.setTimeout = harness.window.setTimeout;
    context.clearTimeout = harness.window.clearTimeout;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const projectLink = harness.document.querySelector('.project-item__link');
    assert.ok(projectLink, 'expected a home project link');
    harness.document.dispatchEvent({
      type: 'click',
      target: projectLink,
      preventDefault() {},
    });
    await flush();
    await flush();

    assert.equal(harness.fetchCalls[0], 'http://localhost/project/proj-2');
    assert.equal(harness.historyCalls[0].type, 'push');
    assert.equal(harness.historyCalls[0].url, 'http://localhost/project/proj-2');
    assert.equal(harness.document.body.getAttribute('data-project-id'), 'proj-2');

    const homeLink = harness.document.querySelector('.brand a');
    assert.ok(homeLink, 'expected a home link on the project page');
    harness.document.dispatchEvent({
      type: 'click',
      target: homeLink,
      preventDefault() {},
    });
    await flush();
    await flush();

    assert.equal(harness.fetchCalls[1], 'http://localhost/');
    assert.equal(harness.historyCalls[1].type, 'push');
    assert.equal(harness.historyCalls[1].url, 'http://localhost/');
    assert.equal(harness.document.body.getAttribute('data-project-id'), '');

    const projectLinkAgain = harness.document.querySelector('.project-item__link');
    assert.ok(projectLinkAgain, 'expected a cached home project link');
    harness.document.dispatchEvent({
      type: 'click',
      target: projectLinkAgain,
      preventDefault() {},
    });
    await flush();
    await flush();

    assert.equal(harness.fetchCalls.length, 2, 'expected the repeated navigation to use the cached HTML');
    assert.equal(harness.historyCalls[2].type, 'push');
    assert.equal(harness.historyCalls[2].url, 'http://localhost/project/proj-2');
    assert.equal(harness.document.body.getAttribute('data-project-id'), 'proj-2');
  });
});
