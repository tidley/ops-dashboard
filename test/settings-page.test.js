const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

function renderSettingsTemplate(locals) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'src/views/settings.ejs'), 'utf8');
  return ejs.render(template, locals, { filename: path.join(__dirname, '..', 'src/views/settings.ejs') });
}

describe('global settings page', function() {
  it('renders the workspace defaults form and wizard', function() {
    const html = renderSettingsTemplate({
      globalWorkspaceSettings: {
        codeFolder: '/home/tom/code',
        subfolders: ['pave', 'sec'],
        ignoreFolders: ['node_modules', 'dist'],
        gettingStarted: 'Read the README first.',
        agentBackend: 'direct-codex',
        routstrProvider: 'openrouter',
        routstrModel: 'gpt-4.1',
      },
      globalSettingsWizard: {
        codeFolder: '/home/tom/code',
        suggestedSubfolders: ['pave', 'sec'],
        commonIgnoreFolders: ['node_modules', 'dist'],
        starterInstructions: 'Read the README first.',
        agentBackend: 'direct-codex',
        routstrProvider: 'openrouter',
        routstrModel: 'gpt-4.1',
      },
    });

    assert.match(html, /Settings/);
    assert.match(html, /Workspace defaults/);
    assert.match(html, /Back-fill from \/home\/tom\/code/);
    assert.match(html, /name="code_folder"/);
    assert.match(html, /name="subfolders"/);
    assert.match(html, /name="ignore_folders"/);
    assert.match(html, /name="getting_started"/);
    assert.match(html, /name="agent_backend"/);
    assert.match(html, /name="routstr_provider"/);
    assert.match(html, /name="routstr_model"/);
    assert.match(html, /wizard_use_code_folder_btn/);
    assert.match(html, /wizard_fill_subfolders_btn/);
    assert.match(html, /wizard_fill_ignores_btn/);
    assert.match(html, /wizard_fill_backend_btn/);
    assert.match(html, /wizard_fill_instructions_btn/);
    assert.match(html, /settings-page\.js/);
  });
});
