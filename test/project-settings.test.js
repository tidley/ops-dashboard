const assert = require('assert');
const {
  getProjectFolderSettings,
  normalizeFolderListField,
  shouldIncludeRecentFile,
  summarizeProjectFolderSettings,
  buildProjectSettingsWizard,
  buildGlobalSettingsWizard,
} = require('../src/project-settings');

describe('project settings helpers', function() {
  it('normalizes folder lists from strings and arrays', function() {
    assert.deepEqual(
      normalizeFolderListField('pave, sec\n./node_modules\npave'),
      ['pave', 'sec', 'node_modules'],
    );
    assert.deepEqual(
      normalizeFolderListField(['pave/', '/sec/', 'pave']),
      ['pave', 'sec'],
    );
  });

  it('uses the configured code folder and global folder filters', function() {
    const project = {
      workspace_dir: '/tmp/project',
      settings_json: {
        code_folder: '/home/tom/code',
        subfolders: ['legacy'],
        ignore_folders: ['legacy-ignore'],
        getting_started: 'Read the README first.',
      },
    };
    const globalSettings = {
      code_folder: '/home/tom/code/global',
      subfolders: ['pave', 'sec'],
      ignore_folders: ['node_modules', 'dist'],
      getting_started: 'Follow the global playbook.',
    };

    const settings = getProjectFolderSettings(project, globalSettings);
    assert.equal(settings.codeFolder, '/home/tom/code');
    assert.deepEqual(settings.subfolders, ['pave', 'sec']);
    assert.deepEqual(settings.ignoreFolders, ['node_modules', 'dist']);
    assert.equal(settings.gettingStarted, 'Read the README first.');
    assert.equal(shouldIncludeRecentFile('pave/src/app.js', settings), true);
    assert.equal(shouldIncludeRecentFile('docs/readme.md', settings), false);
    assert.equal(shouldIncludeRecentFile('node_modules/pkg/index.js', settings), false);
  });

  it('summarizes project settings and builds project/global wizard payloads', function() {
    const project = {
      workspace_dir: '/tmp/project',
      settings_json: {
        imported_from: '/definitely/does/not/exist',
        getting_started: 'Project instructions.',
      },
    };
    const globalSettings = {
      code_folder: '/global/workspace',
      subfolders: ['pave', 'sec'],
      ignore_folders: ['node_modules', 'dist'],
      getting_started: 'Global instructions.',
    };

    const summary = summarizeProjectFolderSettings(project, globalSettings);
    assert.match(summary, /Main code folder: \/definitely\/does\/not\/exist/);
    assert.match(summary, /Subfolders: pave, sec/);
    assert.match(summary, /Ignored folders: node_modules, dist/);

    const wizard = buildProjectSettingsWizard(project, globalSettings);
    assert.equal(wizard.codeFolder, '/definitely/does/not/exist');
    assert.ok(!('suggestedSubfolders' in wizard));
    assert.match(wizard.starterInstructions, /Start by reading/);

    const globalWizard = buildGlobalSettingsWizard(globalSettings);
    assert.equal(globalWizard.codeFolder, '/global/workspace');
    assert.deepEqual(globalWizard.subfolders, ['pave', 'sec']);
    assert.deepEqual(globalWizard.ignoreFolders, ['node_modules', 'dist']);
    assert.ok(Array.isArray(globalWizard.suggestedSubfolders));
    assert.ok(Array.isArray(globalWizard.commonIgnoreFolders));
  });
});
