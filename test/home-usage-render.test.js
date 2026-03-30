const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createNode(tagName) {
  const listeners = {};
  const node = {
    tagName: String(tagName || '').toUpperCase(),
    className: '',
    attributes: {},
    children: [],
    textContent: '',
    hidden: false,
    style: {},
    ownerDocument: null,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class' || name === 'className') {
        this.className = String(value);
      }
    },
    getAttribute(name) {
      if (name === 'class' || name === 'className') {
        return this.className || '';
      }
      return this.attributes[name] || '';
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
    getBoundingClientRect() {
      return { left: 0, width: 1000, top: 0, height: 180 };
    },
    querySelector(selector) {
      return findFirst(this, selector);
    },
    querySelectorAll(selector) {
      return findAll(this, selector);
    },
  };

  Object.defineProperty(node, 'innerHTML', {
    get() {
      return '';
    },
    set() {
      this.children = [];
      this.textContent = '';
    },
  });

  node.classList = {
    add(...names) {
      const next = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
      names.forEach((name) => next.add(name));
      node.className = Array.from(next).join(' ');
    },
    remove(...names) {
      const next = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
      names.forEach((name) => next.delete(name));
      node.className = Array.from(next).join(' ');
    },
    contains(name) {
      return String(node.className || '').split(/\s+/).includes(name);
    },
    toggle(name, force) {
      const next = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
      const shouldAdd = force == null ? !next.has(name) : Boolean(force);
      if (shouldAdd) {
        next.add(name);
      } else {
        next.delete(name);
      }
      node.className = Array.from(next).join(' ');
      return shouldAdd;
    },
  };

  return node;
}

function matchesSelector(node, selector) {
  if (!node) return false;
  if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    const classValue = String(node.className || node.attributes?.class || '').split(/\s+/);
    return classValue.includes(cls);
  }
  if (selector.startsWith('[')) {
    const attrMatch = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (!attrMatch) return false;
    const attr = attrMatch[1];
    const expected = attrMatch[2];
    const actual = node.attributes ? node.attributes[attr] : undefined;
    return expected == null ? actual != null : String(actual) === expected;
  }
  return String(node.tagName || '').toLowerCase() === selector.toLowerCase();
}

function findFirst(node, selector) {
  if (matchesSelector(node, selector)) return node;
  for (const child of node.children || []) {
    const found = findFirst(child, selector);
    if (found) return found;
  }
  return null;
}

function findAll(node, selector, result = []) {
  if (matchesSelector(node, selector)) result.push(node);
  for (const child of node.children || []) {
    findAll(child, selector, result);
  }
  return result;
}

function createHarness() {
  const document = {
    readyState: 'complete',
    createElement(tag) {
      const node = createNode(tag);
      node.ownerDocument = document;
      return node;
    },
    createElementNS(ns, tag) {
      return this.createElement(tag);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };

  const window = {
    document,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Date,
    Boolean,
    RegExp,
    Error,
  };
  window.window = window;
  document.defaultView = window;
  return { window, document };
}

describe('home usage renderer', function() {
  it('renders a line chart with axis labels, hover dynamics, and range toggles', function() {
    const harness = createHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/home-usage.js'), 'utf8');
    const context = vm.createContext({
      ...harness.window,
    });
    context.window = context;
    context.document = harness.document;
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    vm.runInContext(script, context, { filename: 'home-usage.js' });

    const api = context.OpsDashboardHomeUsage;
    assert.ok(api, 'expected usage helpers to be exported');

    const panel = harness.document.createElement('section');
    panel.setAttribute('data-usage-panel', '');
    panel.setAttribute('data-usage-default-range', '7d');

    ['24h', '7d', '30d'].forEach((range) => {
      const button = harness.document.createElement('button');
      button.setAttribute('data-usage-range', range);
      button.textContent = range;
      panel.appendChild(button);
    });

    const node = harness.document.createElement('div');
    node.className = 'usage-chart';
    node.setAttribute('data-usage-chart', '');
    node.setAttribute('data-usage-series-24h', JSON.stringify([0, 20, 40, 10]));
    node.setAttribute('data-usage-labels-24h', JSON.stringify(['00:00', '08:00', '16:00', '23:00']));
    node.setAttribute('data-usage-series-7d', JSON.stringify([0, 30, 10, 80, 50, 90, 60]));
    node.setAttribute('data-usage-labels-7d', JSON.stringify(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']));
    node.setAttribute('data-usage-series-30d', JSON.stringify(Array.from({ length: 30 }, (_, idx) => (idx % 5 === 0 ? idx * 2 : 0))));
    node.setAttribute('data-usage-labels-30d', JSON.stringify(Array.from({ length: 30 }, (_, idx) => `D${idx + 1}`)));
    panel.appendChild(node);

    api.setUsagePanelRange(panel, '7d');

    const svg = findFirst(node, 'svg');
    const pathNode = findFirst(node, 'path');
    const axis = findFirst(node, '.usage-chart__axis');
    const tooltip = findFirst(node, '.usage-chart__tooltip');
    const overlay = findFirst(node, '.usage-chart__overlay');
    const points = findAll(node, '.usage-chart__point');

    assert.ok(svg, 'expected svg chart');
    assert.ok(pathNode, 'expected line path');
    assert.ok(axis, 'expected x-axis labels');
    assert.equal(points.length, 7);
    assert.match(pathNode.getAttribute('d'), /^M\s/);

    const labels = findAll(axis, '.usage-chart__tick');
    assert.equal(labels.length, 7);
    assert.equal(labels[0].textContent, 'Mon');
    assert.equal(labels[6].textContent, 'Sun');

    overlay.dispatchEvent({ type: 'pointerenter', clientX: 500 });
    assert.equal(tooltip.hidden, false);
    assert.match(tooltip.textContent, /tokens/);
    const activeTick = findFirst(axis, '.usage-chart__tick--active');
    assert.ok(activeTick, 'expected an active x-axis tick on hover');

    overlay.dispatchEvent({ type: 'pointerleave', clientX: 500 });
    assert.equal(tooltip.hidden, true);

    api.setUsagePanelRange(panel, '30d');
    const updatedAxis = findFirst(node, '.usage-chart__axis');
    const updatedLabels = findAll(updatedAxis, '.usage-chart__tick');
    assert.equal(node.getAttribute('data-usage-rendered-range'), '30d');
    assert.equal(updatedLabels.length, 30);
  });

  it('updates the active usage-range button when clicked', function() {
    const harness = createHarness();
    const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/home-usage.js'), 'utf8');
    const context = vm.createContext({
      ...harness.window,
    });
    context.window = context;
    context.document = harness.document;
    context.addEventListener = harness.window.addEventListener;
    context.removeEventListener = harness.window.removeEventListener;
    vm.runInContext(script, context, { filename: 'home-usage.js' });

    const api = context.OpsDashboardHomeUsage;
    const panel = harness.document.createElement('section');
    panel.setAttribute('data-usage-panel', '');
    panel.setAttribute('data-usage-default-range', '24h');

    const ranges = {};
    ['24h', '7d', '30d'].forEach((range) => {
      const button = harness.document.createElement('button');
      button.className = range === '24h' ? 'chip chip--active' : 'chip';
      button.setAttribute('data-usage-range', range);
      button.textContent = range;
      panel.appendChild(button);
      ranges[range] = button;
    });

    const node = harness.document.createElement('div');
    node.setAttribute('data-usage-chart', '');
    node.setAttribute('data-usage-series-24h', JSON.stringify([1, 2, 3]));
    node.setAttribute('data-usage-labels-24h', JSON.stringify(['a', 'b', 'c']));
    node.setAttribute('data-usage-series-7d', JSON.stringify([4, 5, 6]));
    node.setAttribute('data-usage-labels-7d', JSON.stringify(['d', 'e', 'f']));
    node.setAttribute('data-usage-series-30d', JSON.stringify([7, 8, 9]));
    node.setAttribute('data-usage-labels-30d', JSON.stringify(['g', 'h', 'i']));
    panel.appendChild(node);

    api.initUsagePanel(panel);
    ranges['7d'].dispatchEvent({ type: 'click' });

    assert.equal(panel.getAttribute('data-usage-range-selected'), '7d');
    assert.equal(ranges['24h'].classList.contains('chip--active'), false);
    assert.equal(ranges['7d'].classList.contains('chip--active'), true);
    assert.equal(ranges['7d'].getAttribute('aria-selected'), 'true');
    assert.equal(node.getAttribute('data-usage-rendered-range'), '7d');
  });
});
