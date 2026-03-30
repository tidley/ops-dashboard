const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createNode(tagName) {
  const listeners = {};
  const node = {
    tagName: String(tagName || '').toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    parentNode: null,
    style: {
      setProperty() {},
      removeProperty() {},
    },
    value: '',
    innerHTML: '',
    classList: {
      add(token) {
        const tokens = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
        if (!token) return;
        tokens.add(token);
        node.className = Array.from(tokens).join(' ');
      },
      remove(token) {
        const tokens = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
        if (!token) return;
        tokens.delete(token);
        node.className = Array.from(tokens).join(' ');
      },
      toggle(token, force) {
        const tokens = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
        if (!token) return false;
        if (force === true) {
          tokens.add(token);
        } else if (force === false) {
          tokens.delete(token);
        } else if (tokens.has(token)) {
          tokens.delete(token);
        } else {
          tokens.add(token);
        }
        node.className = Array.from(tokens).join(' ');
        return tokens.has(token);
      },
      contains(token) {
        return String(node.className || '').split(/\s+/).includes(token);
      },
    },
    setAttribute(name, value) {
      const key = String(name);
      const text = String(value);
      this.attributes[key] = text;
      if (key === 'class') this.className = text;
      if (key === 'value') this.value = text;
      if (key === 'id') this.id = text;
    },
    getAttribute(name) {
      const key = String(name);
      if (Object.prototype.hasOwnProperty.call(this.attributes, key)) return this.attributes[key];
      if (key === 'class') return this.className || '';
      if (key === 'value') return this.value || '';
      if (key === 'id') return this.id || '';
      return '';
    },
    appendChild(child) {
      if (child && typeof child === 'object') {
        child.parentNode = this;
      }
      this.children.push(child);
      return child;
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
      const match = (current) => {
        const value = String(selector || '').trim();
        if (!current || !value) return false;
        if (value.startsWith('[') && value.endsWith(']')) {
          const attr = value.slice(1, -1).split('=')[0].trim();
          return Object.prototype.hasOwnProperty.call(current.attributes || {}, attr);
        }
        if (value.startsWith('.')) {
          return String(current.className || '').split(/\s+/).includes(value.slice(1));
        }
        return String(current.tagName || '').toLowerCase() === value.toLowerCase();
      };
      let current = this;
      while (current) {
        if (match(current)) return current;
        current = current.parentNode;
      }
      return null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      const match = (current) => {
        const value = String(selector || '').trim();
        if (!current || !value) return false;
        if (value.startsWith('[') && value.endsWith(']')) {
          const attr = value.slice(1, -1).split('=')[0].trim();
          return Object.prototype.hasOwnProperty.call(current.attributes || {}, attr);
        }
        if (value.startsWith('.')) {
          return String(current.className || '').split(/\s+/).includes(value.slice(1));
        }
        return String(current.tagName || '').toLowerCase() === value.toLowerCase();
      };
      const walk = (current) => {
        if (!current || typeof current !== 'object') return;
        if (match(current)) results.push(current);
        (current.children || []).forEach(walk);
      };
      (this.children || []).forEach(walk);
      return results;
    },
  };
  Object.defineProperty(node, 'innerHTML', {
    get() {
      return this._innerHTML || '';
    },
    set(value) {
      this._innerHTML = String(value || '');
      if (this._innerHTML === '') {
        this.children = [];
      }
    },
    configurable: true,
  });
  return node;
}

function createHarness() {
  const body = createNode('body');
  body.setAttribute('data-page', 'project');
  body.setAttribute('data-project-id', '');
  body.setAttribute('data-active-tab', 'overview');

  const rail = createNode('aside');
  rail.setAttribute('data-project-rail', '');
  rail.setAttribute('data-project-rail-view', 'recent');
  rail.setAttribute('data-project-rail-recent-count', '0');
  rail.setAttribute('data-project-rail-planning-count', '1');
  rail.setAttribute('data-project-rail-repo-count', '2');

  const section = createNode('div');
  section.className = 'project-rail__section';

  const viewSelect = createNode('select');
  viewSelect.setAttribute('data-project-rail-view-select', '');
  viewSelect.value = 'recent';

  const count = createNode('div');
  count.setAttribute('data-project-rail-view-count', '');
  count.setAttribute('data-recent-files-count', '');
  count.textContent = '0 items';

  const root = createNode('div');
  root.setAttribute('data-recent-files-root', '');
  root.setAttribute('data-recent-files-url', '/api/project/proj-sort/recent-files');
  root.setAttribute('data-recent-files-sort', 'recent:desc');
  root.setAttribute('data-recent-files-limit', '25');

  const list = createNode('div');
  list.setAttribute('data-recent-files-list', '');
  root.appendChild(list);

  const planningRoot = createNode('div');
  planningRoot.setAttribute('data-rail-planning-files-root', '');
  planningRoot.setAttribute('data-planning-files-url', '/api/project/proj-sort/planning-files');
  planningRoot.setAttribute('data-project-file-content-url', '/api/project/proj-sort/file-content');
  planningRoot.hidden = true;

  const planningList = createNode('div');
  planningList.setAttribute('data-rail-planning-files-list', '');
  planningRoot.appendChild(planningList);

  const planningEmpty = createNode('div');
  planningEmpty.setAttribute('data-rail-planning-files-empty', '');
  planningRoot.appendChild(planningEmpty);

  const recent = createNode('button');
  recent.setAttribute('data-recent-files-sort-option', 'recent');
  recent.setAttribute('data-recent-files-sort-default', 'desc');
  recent.setAttribute('aria-selected', 'true');
  const recentLabel = createNode('span');
  recentLabel.className = 'project-rail__sort-label';
  recentLabel.textContent = 'Recent';
  const recentArrow = createNode('span');
  recentArrow.setAttribute('data-recent-files-sort-arrow', '');
  recentArrow.textContent = '↓';
  recent.appendChild(recentLabel);
  recent.appendChild(recentArrow);

  const name = createNode('button');
  name.setAttribute('data-recent-files-sort-option', 'name');
  name.setAttribute('data-recent-files-sort-default', 'asc');
  name.setAttribute('aria-selected', 'false');
  const nameLabel = createNode('span');
  nameLabel.className = 'project-rail__sort-label';
  nameLabel.textContent = 'Name';
  const nameArrow = createNode('span');
  nameArrow.setAttribute('data-recent-files-sort-arrow', '');
  name.appendChild(nameLabel);
  name.appendChild(nameArrow);

  const relative = createNode('button');
  relative.setAttribute('data-recent-files-sort-option', 'path');
  relative.setAttribute('data-recent-files-sort-default', 'asc');
  relative.setAttribute('aria-selected', 'false');
  const relativeLabel = createNode('span');
  relativeLabel.className = 'project-rail__sort-label';
  relativeLabel.textContent = 'Relative';
  const relativeArrow = createNode('span');
  relativeArrow.setAttribute('data-recent-files-sort-arrow', '');
  relative.appendChild(relativeLabel);
  relative.appendChild(relativeArrow);

  const recentPanel = createNode('div');
  recentPanel.setAttribute('data-project-rail-panel', 'recent');
  recentPanel.appendChild(root);

  const planningPanel = createNode('div');
  planningPanel.setAttribute('data-project-rail-panel', 'planning');
  planningPanel.hidden = true;
  planningPanel.appendChild(planningRoot);

  const repoRoot = createNode('div');
  repoRoot.setAttribute('data-rail-repo-root', '');
  repoRoot.setAttribute('data-repo-tree-url', '/api/project/proj-sort/repo-tree');
  repoRoot.setAttribute('data-project-file-content-url', '/api/project/proj-sort/file-content');
  repoRoot.hidden = true;

  const repoTree = createNode('div');
  repoTree.setAttribute('data-rail-repo-tree', '');
  repoRoot.appendChild(repoTree);

  const repoEmpty = createNode('div');
  repoEmpty.setAttribute('data-rail-repo-empty', '');
  repoRoot.appendChild(repoEmpty);

  const repoPanel = createNode('div');
  repoPanel.setAttribute('data-project-rail-panel', 'repo');
  repoPanel.hidden = true;
  repoPanel.appendChild(repoRoot);

  section.appendChild(viewSelect);
  section.appendChild(count);
  section.appendChild(recent);
  section.appendChild(name);
  section.appendChild(relative);
  section.appendChild(recentPanel);
  section.appendChild(planningPanel);
  section.appendChild(repoPanel);
  rail.appendChild(section);
  body.appendChild(rail);

  const listeners = {};
  const document = {
    body,
    readyState: 'complete',
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners[(event && event.type) || ''] || [];
      handlers.forEach((handler) => handler.call(document, event));
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
    createElement: createNode,
    createDocumentFragment: () => createNode('fragment'),
  };

  const fetchCalls = [];
  const window = {
    document,
    history: {
      pushState() {},
      replaceState() {},
    },
    location: {
      origin: 'http://localhost',
      href: 'http://localhost/project/proj-sort',
      search: '',
    },
    addEventListener() {},
    removeEventListener() {},
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    setTimeout,
    clearTimeout,
    fetch(url, options = {}) {
      fetchCalls.push({ url, options });
      const accept = String((options.headers && options.headers.Accept) || '');
      if (accept.includes('application/json')) {
        const requestUrl = new URL(url, 'http://localhost');
        const sort = requestUrl.searchParams.get('sort') || 'recent:desc';
        if (requestUrl.pathname.endsWith('/planning-files')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              files: [
                {
                  name: 'NOW.md',
                  directory: '.planning',
                  file_path: '.planning/NOW.md',
                },
              ],
            }),
          });
        }
        if (requestUrl.pathname.endsWith('/repo-tree')) {
          const dir = requestUrl.searchParams.get('dir') || '';
          if (dir === 'src') {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                files: [
                  {
                    name: 'project-page.js',
                    path: 'src/project-page.js',
                    type: 'file',
                    has_children: false,
                  },
                ],
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              files: [
                {
                  name: 'src',
                  path: 'src',
                  type: 'directory',
                  has_children: true,
                },
                {
                  name: 'README.md',
                  path: 'README.md',
                  type: 'file',
                  has_children: false,
                },
              ],
            }),
          });
        }
        if (requestUrl.pathname.endsWith('/file-content')) {
          const filePath = requestUrl.searchParams.get('path') || '';
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              file_path: filePath || '.planning/NOW.md',
              is_binary: false,
              line_count: 2,
              content: 'first line\nsecond line',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ files: [], sort }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<!doctype html><html><body><div class="shell"></div></body></html>'),
      });
    },
    localStorage: {
      store: Object.create(null),
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
      },
      setItem(key, value) {
        this.store[key] = String(value);
      },
      removeItem(key) {
        delete this.store[key];
      },
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
    FormData,
  };

  window.window = window;
  return {
    window,
    document,
    fetchCalls,
    rail,
    root,
    recent,
    name,
    relative,
    count,
    viewSelect,
    planningPanel,
    planningRoot,
    planningList,
    repoPanel,
    repoRoot,
    repoTree,
  };
}

describe('recent files sort interaction', function() {
  it('switches the active sort button appearance when clicked', async function() {
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
    context.localStorage = harness.window.localStorage;
    context.DOMParser = class {
      parseFromString() {
        return { querySelector() { return null; }, body: null, title: '' };
      }
    };
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    context.setTimeout = harness.window.setTimeout;
    context.clearTimeout = harness.window.clearTimeout;
    context.matchMedia = harness.window.matchMedia;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    await flush();

    assert.equal(harness.root.getAttribute('data-recent-files-sort'), 'recent:desc');
    assert.equal(harness.recent.getAttribute('aria-selected'), 'true');
    assert.equal(harness.name.getAttribute('aria-selected'), 'false');
    assert.equal(harness.name.querySelector('[data-recent-files-sort-arrow]').textContent, '');

    harness.document.dispatchEvent({
      type: 'click',
      target: harness.name,
      preventDefault() {},
    });
    await flush();
    await flush();

    assert.equal(harness.root.getAttribute('data-recent-files-sort'), 'name:asc');
    assert.equal(harness.name.getAttribute('aria-selected'), 'true');
    assert.equal(harness.name.querySelector('[data-recent-files-sort-arrow]').textContent, '↓');
    assert.equal(harness.name.querySelector('.project-rail__sort-label').textContent, 'Name');
    assert.equal(harness.recent.getAttribute('aria-selected'), 'false');
    assert.equal(harness.recent.querySelector('.project-rail__sort-label').textContent, 'Recent');
    assert.equal(harness.count.textContent, '0 items');
    assert.equal(harness.fetchCalls.filter((entry) => String(entry.url || '').includes('/recent-files')).length >= 1, true);
  });

  it('switches the rail body to planning files from the view dropdown', async function() {
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
    context.localStorage = harness.window.localStorage;
    context.DOMParser = class {
      parseFromString() {
        return { querySelector() { return null; }, body: null, title: '' };
      }
    };
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    context.setTimeout = harness.window.setTimeout;
    context.clearTimeout = harness.window.clearTimeout;
    context.matchMedia = harness.window.matchMedia;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    await flush();

    assert.equal(harness.rail.getAttribute('data-project-rail-view'), 'recent');
    assert.equal(harness.planningPanel.hidden, true);

    harness.viewSelect.value = 'planning';
    harness.document.dispatchEvent({
      type: 'change',
      target: harness.viewSelect,
    });
    await flush();
    await flush();

    assert.equal(harness.rail.getAttribute('data-project-rail-view'), 'planning');
    assert.equal(harness.planningPanel.hidden, false);
    assert.equal(harness.count.textContent, '1 items');
    assert.equal(harness.fetchCalls.some((entry) => String(entry.url || '').includes('/planning-files')), true);
  });

  it('opens a planning file inline in the rail and loads file contents', async function() {
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
    context.localStorage = harness.window.localStorage;
    context.DOMParser = class {
      parseFromString() {
        return { querySelector() { return null; }, body: null, title: '' };
      }
    };
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    context.setTimeout = harness.window.setTimeout;
    context.clearTimeout = harness.window.clearTimeout;
    context.matchMedia = harness.window.matchMedia;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    await flush();

    harness.viewSelect.value = 'planning';
    harness.document.dispatchEvent({
      type: 'change',
      target: harness.viewSelect,
    });
    await flush();
    await flush();

    const trigger = harness.planningRoot.querySelector('[data-rail-planning-file-trigger]');
    assert.ok(trigger);

    harness.document.dispatchEvent({
      type: 'click',
      target: trigger,
      preventDefault() {},
    });
    await flush();
    await flush();

    const body = harness.planningRoot.querySelector('[data-rail-planning-file-body]');
    assert.ok(body);
    const lineCodes = body.querySelectorAll('.planning-file-viewer__line-code');
    assert.equal(lineCodes.length, 2);
    assert.equal(lineCodes[0].textContent, 'first line');
    assert.equal(lineCodes[1].textContent, 'second line');
    assert.equal(harness.fetchCalls.some((entry) => String(entry.url || '').includes('/file-content')), true);
  });

  it('switches the rail body to repo explorer from the view dropdown and opens nested files', async function() {
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
    context.localStorage = harness.window.localStorage;
    context.DOMParser = class {
      parseFromString() {
        return { querySelector() { return null; }, body: null, title: '' };
      }
    };
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    context.setTimeout = harness.window.setTimeout;
    context.clearTimeout = harness.window.clearTimeout;
    context.matchMedia = harness.window.matchMedia;
    vm.runInContext(script, context, { filename: 'project-page.js' });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
    await flush();

    harness.viewSelect.value = 'repo';
    harness.document.dispatchEvent({
      type: 'change',
      target: harness.viewSelect,
    });
    await flush();
    await flush();

    assert.equal(harness.rail.getAttribute('data-project-rail-view'), 'repo');
    assert.equal(harness.repoPanel.hidden, false);
    assert.equal(harness.fetchCalls.some((entry) => String(entry.url || '').includes('/repo-tree')), true);

    const folderTrigger = harness.repoRoot.querySelector('[data-repo-tree-folder-toggle]');
    assert.ok(folderTrigger);
    harness.document.dispatchEvent({
      type: 'click',
      target: folderTrigger,
      preventDefault() {},
    });
    await flush();
    await flush();

    assert.equal(harness.fetchCalls.some((entry) => String(entry.url || '').includes('/repo-tree?dir=src')), true);

    const fileTrigger = harness.repoRoot.querySelector('[data-repo-tree-file-trigger]');
    assert.ok(fileTrigger);
    harness.document.dispatchEvent({
      type: 'click',
      target: fileTrigger,
      preventDefault() {},
    });
    await flush();
    await flush();

    const body = harness.repoRoot.querySelector('[data-repo-tree-file-body]');
    assert.ok(body);
    const lineCodes = body.querySelectorAll('.planning-file-viewer__line-code');
    assert.equal(lineCodes.length, 2);
    assert.equal(lineCodes[0].textContent, 'first line');
    assert.equal(harness.fetchCalls.some((entry) => String(entry.url || '').includes('/file-content?path=src%2Fproject-page.js')), true);
  });
});
