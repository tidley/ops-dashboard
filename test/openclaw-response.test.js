const assert = require('assert');
const {
  extractTextFromOpenClawResponse,
  normalizeOpenClawResponse,
} = require('../src/router');

describe('openclaw response normalization', function() {
  it('extracts payload text from the standard JSON shape', function() {
    const text = extractTextFromOpenClawResponse({
      payloads: [
        { text: 'Hello from OpenClaw', mediaUrl: null }
      ],
      meta: {},
    });

    assert.equal(text, 'Hello from OpenClaw');
  });

  it('treats a literal null reply as no text output', function() {
    const normalized = normalizeOpenClawResponse('null', null);
    assert.equal(normalized.status, 'error');
    assert.equal(normalized.output, '(no reply)');
    assert.match(normalized.error, /no textual reply/i);
  });

  it('falls back to raw text when it is present', function() {
    const normalized = normalizeOpenClawResponse('some plain text', null);
    assert.equal(normalized.status, 'ok');
    assert.equal(normalized.output, 'some plain text');
  });
});
