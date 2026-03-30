(function() {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var RANGE_KEYS = ['24h', '7d', '30d'];

  function createElement(name, isSvg) {
    if (isSvg && document.createElementNS) {
      return document.createElementNS(SVG_NS, name);
    }
    return document.createElement(name);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function parseJsonAttribute(node, name, fallback) {
    try {
      return JSON.parse(node.getAttribute(name) || 'null') || fallback;
    } catch {
      return fallback;
    }
  }

  function shouldShowAxisLabel(index, total) {
    if (total <= 7) return true;
    if (total <= 12) return index % 2 === 0 || index === total - 1;
    if (total <= 24) return index % 3 === 0 || index === total - 1;
    return index % 5 === 0 || index === total - 1;
  }

  function buildPath(points) {
    if (!points.length) return '';
    return points.map(function(point, index) {
      var prefix = index === 0 ? 'M' : 'L';
      return prefix + ' ' + point.x + ' ' + point.y;
    }).join(' ');
  }

  function clearNode(node) {
    while (node.firstChild || (node.children && node.children.length)) {
      var child = node.firstChild || node.children[0];
      if (!child) break;
      node.removeChild(child);
    }
  }

  function findAncestor(node, predicate) {
    var current = node && node.parentNode;
    while (current) {
      if (predicate(current)) return current;
      current = current.parentNode;
    }
    return null;
  }

  function getRangeConfig(node, rangeKey) {
    var requestedRange = rangeKey || node.getAttribute('data-usage-default-range') || '';
    if (requestedRange && requestedRange !== 'default') {
      var rangeSeries = parseJsonAttribute(node, 'data-usage-series-' + requestedRange, null);
      var rangeLabels = parseJsonAttribute(node, 'data-usage-labels-' + requestedRange, null);
      if (Array.isArray(rangeSeries) && rangeSeries.length) {
        return {
          rangeKey: requestedRange,
          series: rangeSeries,
          labels: Array.isArray(rangeLabels) ? rangeLabels : [],
        };
      }
    }

    var legacySeries = parseJsonAttribute(node, 'data-usage-series', null);
    var legacyLabels = parseJsonAttribute(node, 'data-usage-labels', null);
    if (Array.isArray(legacySeries) && legacySeries.length) {
      return {
        rangeKey: requestedRange || 'default',
        series: legacySeries,
        labels: Array.isArray(legacyLabels) ? legacyLabels : [],
      };
    }

    for (var idx = 0; idx < RANGE_KEYS.length; idx += 1) {
      var fallbackRange = RANGE_KEYS[idx];
      var fallbackSeries = parseJsonAttribute(node, 'data-usage-series-' + fallbackRange, null);
      var fallbackLabels = parseJsonAttribute(node, 'data-usage-labels-' + fallbackRange, null);
      if (Array.isArray(fallbackSeries) && fallbackSeries.length) {
        return {
          rangeKey: fallbackRange,
          series: fallbackSeries,
          labels: Array.isArray(fallbackLabels) ? fallbackLabels : [],
        };
      }
    }

    return null;
  }

  function renderUsageChart(node, rangeKey) {
    if (!node) return;

    var data = getRangeConfig(node, rangeKey);
    if (!data) return;

    var selectedRange = data.rangeKey || 'default';
    if (node.getAttribute('data-usage-rendered-range') === selectedRange) return;

    var values = data.series.map(function(value) {
      var num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : 0;
    });
    var width = 1000;
    var height = String(node.className || '').indexOf('usage-chart--mini') !== -1 ? 120 : 180;
    var paddingX = 44;
    var paddingTop = 18;
    var paddingBottom = 32;
    var innerWidth = Math.max(1, width - (paddingX * 2));
    var innerHeight = Math.max(1, height - paddingTop - paddingBottom);
    var max = values.reduce(function(acc, value) {
      return value > acc ? value : acc;
    }, 0) || 1;
    var step = values.length > 1 ? innerWidth / (values.length - 1) : 0;

    var points = values.map(function(value, index) {
      var x = values.length > 1 ? paddingX + (index * step) : paddingX + (innerWidth / 2);
      var y = paddingTop + innerHeight - ((value / max) * innerHeight);
      return {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        left: Math.round((x / width) * 10000) / 100,
        top: Math.round((y / height) * 10000) / 100,
        value: value,
        index: index,
        label: data.labels[index] || String(index + 1),
      };
    });

    clearNode(node);
    node.setAttribute('data-usage-rendered', 'true');
    node.setAttribute('data-usage-rendered-range', selectedRange);

    var chartFrame = createElement('div', false);
    chartFrame.className = 'usage-chart__frame';

    var svg = createElement('svg', true);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'OpenClaw usage chart');

    var axisLine = createElement('line', true);
    axisLine.setAttribute('x1', String(paddingX));
    axisLine.setAttribute('x2', String(width - paddingX));
    axisLine.setAttribute('y1', String(height - paddingBottom + 6));
    axisLine.setAttribute('y2', String(height - paddingBottom + 6));
    axisLine.setAttribute('class', 'usage-chart__axis-line');
    axisLine.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(axisLine);

    var path = createElement('path', true);
    path.setAttribute('d', buildPath(points));
    path.setAttribute('class', 'usage-chart__line');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(path);

    var hoverLine = createElement('line', true);
    hoverLine.setAttribute('class', 'usage-chart__hover-line');
    hoverLine.setAttribute('y1', String(paddingTop));
    hoverLine.setAttribute('y2', String(height - paddingBottom + 6));
    hoverLine.setAttribute('visibility', 'hidden');
    hoverLine.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(hoverLine);

    var overlay = createElement('rect', true);
    overlay.setAttribute('x', '0');
    overlay.setAttribute('y', '0');
    overlay.setAttribute('width', String(width));
    overlay.setAttribute('height', String(height));
    overlay.setAttribute('class', 'usage-chart__overlay');
    overlay.setAttribute('fill', 'transparent');
    overlay.setAttribute('pointer-events', 'all');
    svg.appendChild(overlay);

    chartFrame.appendChild(svg);

    var markers = createElement('div', false);
    markers.className = 'usage-chart__markers';
    points.forEach(function(point) {
      var circle = createElement('div', false);
      circle.className = 'usage-chart__point';
      circle.setAttribute('data-usage-index', String(point.index));
      circle.setAttribute('data-usage-value', String(point.value));
      circle.setAttribute('data-usage-label', point.label);
      circle.style.left = point.left + '%';
      circle.style.top = point.top + '%';
      markers.appendChild(circle);
    });

    var hoverPoint = createElement('div', false);
    hoverPoint.className = 'usage-chart__hover-point';
    hoverPoint.hidden = true;
    hoverPoint.style.left = '0%';
    hoverPoint.style.top = '0%';
    markers.appendChild(hoverPoint);

    chartFrame.appendChild(markers);

    var tooltip = createElement('div', false);
    tooltip.className = 'usage-chart__tooltip';
    tooltip.hidden = true;
    chartFrame.appendChild(tooltip);

    var axis = createElement('div', false);
    axis.className = 'usage-chart__axis';

    points.forEach(function(point, index) {
      var tick = createElement('span', false);
      tick.className = 'usage-chart__tick' + (shouldShowAxisLabel(index, points.length) ? ' usage-chart__tick--labelled' : '');
      tick.setAttribute('data-usage-index', String(index));
      tick.style.left = (point.x / width * 100) + '%';
      tick.textContent = shouldShowAxisLabel(index, points.length) ? point.label : '·';
      axis.appendChild(tick);
    });

    node.appendChild(chartFrame);
    node.appendChild(axis);

    var highlightedTick = null;

    function setActive(index) {
      var point = points[index];
      if (!point) return;

      hoverLine.setAttribute('x1', String(point.x));
      hoverLine.setAttribute('x2', String(point.x));
      hoverLine.setAttribute('visibility', 'visible');
      hoverPoint.style.left = point.left + '%';
      hoverPoint.style.top = point.top + '%';
      hoverPoint.hidden = false;
      tooltip.hidden = false;
      tooltip.textContent = point.label + ' · ' + point.value.toLocaleString('en-US') + ' tokens';
      tooltip.style.left = clamp(point.left, 8, 92) + '%';
      tooltip.style.top = Math.max(0, point.top - 18) + '%';

      if (highlightedTick) highlightedTick.classList.remove('usage-chart__tick--active');
      highlightedTick = axis.querySelector('[data-usage-index="' + index + '"]');
      if (highlightedTick) highlightedTick.classList.add('usage-chart__tick--active');
    }

    function clearActive() {
      hoverLine.setAttribute('visibility', 'hidden');
      hoverPoint.hidden = true;
      tooltip.hidden = true;
      if (highlightedTick) highlightedTick.classList.remove('usage-chart__tick--active');
      highlightedTick = null;
    }

    function nearestIndexFromEvent(event) {
      var rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { left: 0, width: width };
      var offsetX = event.clientX - rect.left;
      var x = rect.width ? (offsetX / rect.width) * width : offsetX;
      if (values.length === 1) return 0;
      var raw = Math.round((x - paddingX) / step);
      return clamp(raw, 0, points.length - 1);
    }

    overlay.addEventListener('pointermove', function(event) {
      setActive(nearestIndexFromEvent(event));
    });
    overlay.addEventListener('pointerenter', function(event) {
      setActive(nearestIndexFromEvent(event));
    });
    overlay.addEventListener('pointerleave', clearActive);
    overlay.addEventListener('focus', function() {
      setActive(0);
    });
  }

  function setUsagePanelRange(panel, rangeKey) {
    if (!panel) return;
    var charts = Array.prototype.slice.call(panel.querySelectorAll('[data-usage-chart]'));
    var buttons = Array.prototype.slice.call(panel.querySelectorAll('[data-usage-range]'));
    var selectedRange = rangeKey || panel.getAttribute('data-usage-default-range') || (buttons[0] && buttons[0].getAttribute('data-usage-range')) || '24h';

    panel.setAttribute('data-usage-range-selected', selectedRange);
    buttons.forEach(function(button) {
      var active = button.getAttribute('data-usage-range') === selectedRange;
      button.classList.toggle('chip--active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    charts.forEach(function(chart) {
      renderUsageChart(chart, selectedRange);
    });
  }

  function initUsagePanel(panel) {
    if (!panel || panel.__opsDashboardUsageBound) {
      setUsagePanelRange(panel, panel && panel.getAttribute ? panel.getAttribute('data-usage-range-selected') || panel.getAttribute('data-usage-default-range') : '24h');
      return;
    }
    panel.__opsDashboardUsageBound = true;

    var buttons = Array.prototype.slice.call(panel.querySelectorAll('[data-usage-range]'));
    if (!buttons.length) return;

    buttons.forEach(function(button) {
      button.setAttribute('role', 'tab');
      button.addEventListener('click', function() {
        setUsagePanelRange(panel, button.getAttribute('data-usage-range'));
      });
    });

    setUsagePanelRange(panel, panel.getAttribute('data-usage-default-range'));
  }

  function initStandaloneCharts() {
    document.querySelectorAll('[data-usage-chart]').forEach(function(chart) {
      if (!findAncestor(chart, function(node) {
        return node && node.getAttribute && node.getAttribute('data-usage-panel') != null;
      })) {
        renderUsageChart(chart, chart.getAttribute('data-usage-default-range'));
      }
    });
  }

  function initUsageCharts() {
    document.querySelectorAll('[data-usage-panel]').forEach(initUsagePanel);
    initStandaloneCharts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsageCharts);
  } else {
    initUsageCharts();
  }

  window.OpsDashboardHomeUsage = {
    renderUsageChart: renderUsageChart,
    initUsageCharts: initUsageCharts,
    initUsagePanel: initUsagePanel,
    setUsagePanelRange: setUsagePanelRange,
  };
})();
