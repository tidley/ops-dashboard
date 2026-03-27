(function() {
  function setOpen(open) {
    document.body.classList.toggle('sidebar-open', Boolean(open));
    var button = document.querySelector('[data-sidebar-toggle]');
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function init() {
    var button = document.querySelector('[data-sidebar-toggle]');
    var backdrop = document.querySelector('[data-sidebar-backdrop]');
    if (!button || !backdrop) return;

    button.addEventListener('click', function() {
      setOpen(!document.body.classList.contains('sidebar-open'));
    });

    backdrop.addEventListener('click', function() {
      setOpen(false);
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setOpen(false);
    });
  }

  init();
})();
