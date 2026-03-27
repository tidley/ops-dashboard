(function() {
  const form = document.getElementById('message_form');
  if (!form) return;

  const chatThread = document.querySelector('.chat-thread');
  const textarea = form.querySelector('#text');
  const agentInput = form.querySelector('#agent_id');
  const projectId = document.body.dataset.projectId;
  const activeSessionInput = form.querySelector('input[name="session_id"]') || form.querySelector('#session_id');
  // Prefer the hidden input? Our form uses select for session. We'll take the selected value.
  function getSessionId() {
    const sel = form.querySelector('#session_id');
    return sel ? sel.value : '';
  }

  function formatTimeAgo(value) {
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return '';
    const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (deltaSec < 60) return 'just now';
    if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
    if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
    return `${Math.floor(deltaSec / 86400)}d ago`;
  }

  function renderMessage(msg, agentsMap) {
    const isOutbound = msg.direction === 'outbound';
    const agentName = (() => {
      if (msg.direction === 'outbound') return 'You';
      if (msg.agent_id && agentsMap[msg.agent_id]) return agentsMap[msg.agent_id].name;
      if (msg.message_type === 'codex') return 'Codex';
      return 'Agent';
    })();

    const avatar = agentName.split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase() || '??';
    const created = new Date(msg.created_at);
    const absolute = `${created.toLocaleDateString()} ${created.toLocaleTimeString()}`;

    return `
      <article class="chat-row ${isOutbound ? 'chat-row--outbound' : 'chat-row--inbound'}">
        <div class="chat-row__avatar">${avatar}</div>
        <div class="chat-row__content">
          <div class="chat-bubble">
            <pre class="chat-bubble__body">${msg.content || '(empty)'}</pre>
            ${msg.error_text ? `<div class="chat-bubble__error">${msg.error_text}</div>` : ''}
          </div>
          <div class="chat-row__stamp" title="${absolute}">${absolute} · ${formatTimeAgo(msg.created_at)}</div>
        </div>
      </article>
    `;
  }

  function getAgentsMap() {
    const map = {
      'agent-openclaw-main': { name: 'OpenClaw Main', kind: 'openclaw' }
    };
    const agentId = agentInput ? agentInput.value : '';
    if (agentId && !map[agentId]) map[agentId] = { name: 'Agent', kind: '' };
    return map;
  }

  function appendMessage(msg) {
    const html = renderMessage(msg, getAgentsMap());
    const div = document.createElement('div');
    div.innerHTML = html;
    chatThread.appendChild(div.firstElementChild);
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function replaceThread(messages) {
    chatThread.innerHTML = '';
    messages.forEach(msg => {
      appendMessage(msg);
    });
  }

  function submitMessage(e) {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;

    const formData = new FormData(form);
    // Ensure text is set (in case it changed)
    formData.set('text', text);
    // Remove payload_json since we removed the field from UI; any leftover should be dropped
    if (formData.has('payload_json')) formData.delete('payload_json');

    // Include the clicked button's name/value (message_type)
    const submitter = e.submitter;
    if (submitter && submitter.name) {
      formData.append(submitter.name, submitter.value);
    }

    // Optimistically add outbound placeholder
    const messageType = formData.get('message_type') || 'prompt';
    const priority = formData.get('priority') || 'normal';
    const agentId = formData.get('agent_id') || '';
    const workflowId = formData.get('workflow_id') || '';

    const tempOutbound = {
      direction: 'outbound',
      message_type: messageType,
      priority,
      agent_id: agentId,
      workflow_id: workflowId,
      payload: { text },
      content: text,
      status: 'queued',
      created_at: new Date().toISOString(),
      error_text: ''
    };
    appendMessage(tempOutbound);
    textarea.value = '';
    textarea.focus();

    // Convert FormData to URLSearchParams (application/x-www-form-urlencoded)
    const body = new URLSearchParams(formData).toString();

    fetch(`/api/project/${projectId}/message`, {
      method: 'POST',
      body: body,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
      .then(res => res.ok ? res.json() : res.text().then(t => Promise.reject(t)))
      .then(data => {
        if (data && data.messages) {
          replaceThread(data.messages);
          if (data.session_id) {
            const select = form.querySelector('#session_id');
            if (select) {
              const existing = Array.from(select.options).some(opt => opt.value === data.session_id);
              if (!existing) {
                const opt = document.createElement('option');
                opt.value = data.session_id;
                opt.textContent = `Session ${data.session_id.slice(0,8)}`;
                opt.selected = true;
                select.appendChild(opt);
              } else {
                select.value = data.session_id;
              }
            }
          }
        }
      })
      .catch(err => {
        console.error('Send failed:', err);
        tempOutbound.status = 'error';
        tempOutbound.error_text = String(err);
        // Re-render the last message (update the queued one)
        // Since we appended it, replace the last child
        if (chatThread.lastElementChild) {
          const html = renderMessage(tempOutbound, getAgentsMap());
          chatThread.lastElementChild.outerHTML = html;
        } else {
          fetchMessages();
        }
      });
  }

  function fetchMessages() {
    const sessionId = getSessionId();
    if (!sessionId) return;
    fetch(`/api/project/${projectId}/messages?session_id=${encodeURIComponent(sessionId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.messages) replaceThread(data.messages);
      })
      .catch(console.error);
  }

  form.addEventListener('submit', submitMessage);
})();
