(function() {
  'use strict';

  function getWizard() {
    return window.GLOBAL_SETTINGS_WIZARD || {};
  }

  function getField(id) {
    return document.getElementById(id);
  }

  function setFieldValue(id, value) {
    var field = getField(id);
    if (!field) return;
    field.value = String(value || '');
    if (typeof field.focus === 'function') {
      field.focus({ preventScroll: true });
    }
    if (typeof field.scrollIntoView === 'function') {
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function wireSettingsWizard() {
    var wizard = getWizard();
    var codeFolderBtn = document.getElementById('wizard_use_code_folder_btn');
    var subfoldersBtn = document.getElementById('wizard_fill_subfolders_btn');
    var ignoresBtn = document.getElementById('wizard_fill_ignores_btn');
    var instructionsBtn = document.getElementById('wizard_fill_instructions_btn');

    if (codeFolderBtn) {
      codeFolderBtn.addEventListener('click', function() {
        setFieldValue('code_folder', wizard.codeFolder || '');
      });
    }

    if (subfoldersBtn) {
      subfoldersBtn.addEventListener('click', function() {
        var suggestions = Array.isArray(wizard.suggestedSubfolders) ? wizard.suggestedSubfolders : [];
        setFieldValue('subfolders', suggestions.join('\n'));
      });
    }

    if (ignoresBtn) {
      ignoresBtn.addEventListener('click', function() {
        var commonIgnoreFolders = Array.isArray(wizard.commonIgnoreFolders) ? wizard.commonIgnoreFolders : [];
        setFieldValue('ignore_folders', commonIgnoreFolders.join('\n'));
      });
    }

    if (instructionsBtn) {
      instructionsBtn.addEventListener('click', function() {
        setFieldValue('getting_started', wizard.starterInstructions || '');
      });
    }
  }

  wireSettingsWizard();
})();
