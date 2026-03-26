const { v4: uuid } = require('uuid');

async function routeToAgent({ agent, envelope }) {
  if (!agent || agent.kind === 'echo') {
    return {
      status: 'ok',
      output: `Echo(${envelope.agent_id || 'none'}): ${envelope.payload?.text || envelope.payload?.prompt || 'No text payload'}`,
      toolOutput: { adapter: 'echo' }
    };
  }

  if (agent.kind === 'http') {
    const cfg = JSON.parse(agent.config_json || '{}');
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {})
      },
      body: JSON.stringify(envelope)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: 'error', output: '', error: json.error || `HTTP ${res.status}`, toolOutput: json };
    }

    return {
      status: 'ok',
      output: json.reply || json.output || JSON.stringify(json),
      toolOutput: json
    };
  }

  return {
    status: 'error',
    output: '',
    error: `Unsupported agent kind: ${agent.kind}`,
    toolOutput: { knownKinds: ['echo', 'http'], requestId: uuid() }
  };
}

module.exports = { routeToAgent };
