/* Shared docs UI helpers */
(function(){
  function $(sel, root=document){ return root.querySelector(sel); }
  function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function debounce(fn, wait){
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  window.DocsUI = {
    $, $all, debounce,
    setActiveNavByHref: function(activeHref){
      const links = $all('[data-nav-link]');
      links.forEach(a => {
        const isActive = a.getAttribute('href') === activeHref;
        if (isActive) a.setAttribute('aria-current','page');
        else a.removeAttribute('aria-current');
      });
    },

    setActiveNavFromLocation: function(){
      const path = (location.pathname || '').split('/').pop() || 'index.html';
      DocsUI.setActiveNavByHref('./' + path);
    },

    wireMobileSidebar: function(){
      const toggle = $('[data-sidebar-toggle]');
      const overlay = $('[data-sidebar-overlay]');

      if (!toggle) return;

      function open(){ document.body.classList.add('sidebar-open'); }
      function close(){ document.body.classList.remove('sidebar-open'); }
      function isOpen(){ return document.body.classList.contains('sidebar-open'); }

      toggle.addEventListener('click', () => {
        if (isOpen()) close();
        else open();
      });

      if (overlay) overlay.addEventListener('click', close);
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
      });

      // Auto-close on navigation (esp. mobile)
      $all('[data-nav-link]').forEach(a => a.addEventListener('click', close));
    }
  };
})();
