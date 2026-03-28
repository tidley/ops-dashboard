(function() {
  'use strict';

  function getRoot() {
    return document.querySelector('[data-openclaw-control-root]');
  }

  function text(value, fallback) {
    var str = String(value == null ? '' : value).trim();
    return str || (fallback || '');
  }

  function setText(selector, value, fallback) {
    var node = document.querySelector(selector);
    if (!node) return;
    node.textContent = text(value, fallback);
  }

  function setList(root, selector, items) {
    var node = root.querySelector(selector);
    if (!node) return;
    node.innerHTML = '';
    (Array.isArray(items) ? items : []).forEach(function(item) {
      var row = document.createElement('div');
      row.className = 'bullet-stack__item';
      row.textContent = text(item, '');
      if (row.textContent) node.appendChild(row);
    });
  }

  function setMiniList(root, selector, entries) {
    var node = root.querySelector(selector);
    if (!node) return;
    node.innerHTML = '';
    (Array.isArray(entries) ? entries : []).forEach(function(entry) {
      var row = document.createElement('div');
      row.className = 'mini-list__item';
      var strong = document.createElement('strong');
      strong.textContent = text(entry.label, '');
      var span = document.createElement('span');
      span.textContent = text(entry.value, '');
      row.appendChild(strong);
      row.appendChild(span);
      if (strong.textContent || span.textContent) node.appendChild(row);
    });
  }

  function updateModelSelect(root, summary) {
    var select = root.querySelector('[data-openclaw-model-select]');
    if (!select) return;
    var allowed = Array.isArray(summary.allowedModels) && summary.allowedModels.length
      ? summary.allowedModels
      : [summary.defaultModel || ''];
    var options = allowed.filter(Boolean);
    select.innerHTML = '';
    if (!options.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = 'Unavailable';
      select.appendChild(opt);
      return;
    }
    options.forEach(function(model) {
      var opt = document.createElement('option');
      opt.value = model;
      opt.textContent = model;
      if (model === summary.defaultModel) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function updateFallbacks(root, summary) {
    var textarea = root.querySelector('[data-openclaw-fallbacks]');
    if (!textarea) return;
    textarea.value = (Array.isArray(summary.fallbackModels) ? summary.fallbackModels : []).join('\n');
  }

  function updateNotice(root, snapshot) {
    var node = root.querySelector('[data-openclaw-control-notice]');
    var warning = snapshot && Array.isArray(snapshot.warnings) && snapshot.warnings.length ? snapshot.warnings[0] : '';
    var error = snapshot && snapshot.ok === false && !snapshot.loading ? (snapshot.error || 'OpenClaw control data is currently unavailable.') : '';
    if (!node) return;
    if (!error && !warning) {
      node.remove();
      return;
    }
    node.textContent = error || warning;
    node.classList.toggle('openclaw-control__notice--error', Boolean(error));
    node.classList.toggle('openclaw-control__notice--warning', Boolean(warning && !error));
  }

  function render(snapshot) {
    var root = getRoot();
    if (!root || !snapshot || !snapshot.summary) return;
    var summary = snapshot.summary;
    setText('[data-openclaw-gateway-mode]', summary.gatewayBindMode || 'local', 'local');
    setText('[data-openclaw-gateway-port-status]', summary.gatewayPortStatus || 'unknown', 'unknown');
    setText('[data-openclaw-default-model]', summary.defaultModel || 'unknown', 'unknown');
    setText('[data-openclaw-backup-model-count]', (summary.fallbackModels || []).length, '0');
    setText('[data-openclaw-session-count]', summary.sessionCount || 0, '0');
    setText('[data-openclaw-runtime-version]', summary.runtimeVersion || 'unknown', 'unknown');
    setText('[data-openclaw-runtime-line]', `${summary.runtimeVersion || 'unknown'} · ${summary.configPath || 'config unavailable'}`, 'unknown');
    setText('[data-openclaw-gateway-line]', `${summary.gatewayBindMode || 'unknown'} · ${summary.gatewayBindHost || 'unknown'}:${summary.gatewayPort || 0} · ${summary.gatewayPortStatus || 'unknown'}`, 'unknown');
    setText('[data-openclaw-rpc-line]', `${summary.gatewayRpcOk === true ? 'ok' : 'closed'}${summary.gatewayRpcError ? ` · ${summary.gatewayRpcError}` : ''}`, 'closed');
    setText('[data-openclaw-sessions-line]', `${summary.sessionCount || 0} total · ${summary.recentSessionCount || 0} recent · ${summary.queuedSystemEvents || 0} queued system events`, '0 total');
    setList(root, '[data-openclaw-channels]', summary.channelSummary);
    setMiniList(root, '[data-openclaw-auth-providers]', summary.authProviders && summary.authProviders.length
      ? summary.authProviders.map(function(provider) {
          return { label: provider.provider, value: provider.status || provider.effective?.kind || 'unknown' };
        })
      : []);
    setList(root, '[data-openclaw-gateway-audit]', summary.gatewayConfigAuditIssues && summary.gatewayConfigAuditIssues.length
      ? summary.gatewayConfigAuditIssues.map(function(issue) { return issue.message || issue.code; })
      : []);
    updateModelSelect(root, summary);
    updateFallbacks(root, summary);
    updateNotice(root, snapshot);
  }

  async function refresh() {
    var root = getRoot();
    if (!root) return;
    var endpoint = root.getAttribute('data-openclaw-refresh-endpoint') || '/api/openclaw/control-panel';
    try {
      var response = await fetch(endpoint, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`refresh failed (${response.status})`);
      var snapshot = await response.json();
      render(snapshot);
    } catch (error) {
      render({
        ok: false,
        error: error && error.message ? error.message : String(error || 'openclaw control refresh failed'),
        summary: {
          gatewayBindMode: 'unknown',
          gatewayPortStatus: 'unknown',
          defaultModel: 'unknown',
          fallbackModels: [],
          sessionCount: 0,
          runtimeVersion: 'unknown',
          configPath: '',
          gatewayBindHost: 'unknown',
          gatewayPort: 0,
          gatewayRpcOk: false,
          gatewayRpcError: '',
          recentSessionCount: 0,
          queuedSystemEvents: 0,
          channelSummary: [],
          authProviders: [],
          gatewayConfigAuditIssues: [],
          allowedModels: [],
        },
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once: true });
  } else {
    refresh();
  }

  window.OpsDashboardOpenClawControl = {
    refresh: refresh,
    render: render,
  };
})();
