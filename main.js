/* ==========================================================================
   Leafpress: shared site script
   Loaded on every page. Put code here that all tools can use.
   Each tool keeps its own script (for example js/image-to-pdf.js).
   ========================================================================== */
(function () {
  'use strict';

  // Shared namespace so tools can share helpers without global clutter.
  var ns = (window.Leafpress = window.Leafpress || {});

  /** Format a byte count for people, like "2.4 MB". */
  ns.formatBytes = function (bytes) {
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(0) + ' KB'; }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  /** Turn a user-typed file name into something safe to download. */
  ns.safeFileName = function (name, fallback) {
    var cleaned = String(name || '')
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return cleaned || fallback || 'download';
  };

  // Tools drop-down: opens on hover (mouse), or on click/tap and keyboard.
  var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  var menus = document.querySelectorAll('.has-menu');
  Array.prototype.forEach.call(menus, function (menu) {
    var button = menu.querySelector('.menu-toggle');
    if (!button) { return; }
    var openedByHover = false;
    var closeTimer = null;

    function setOpen(open) {
      menu.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (openedByHover) {          // a click while hover-open keeps the menu pinned open
        openedByHover = false;
        return;
      }
      setOpen(!menu.classList.contains('is-open'));
    });

    if (canHover) {
      menu.addEventListener('mouseenter', function () {
        clearTimeout(closeTimer);
        if (!menu.classList.contains('is-open')) {
          openedByHover = true;
          setOpen(true);
        }
      });
      menu.addEventListener('mouseleave', function () {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(function () {
          if (openedByHover) {
            openedByHover = false;
            setOpen(false);
          }
        }, 180);
      });
    }

    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.classList.contains('is-open')) {
        openedByHover = false;
        setOpen(false);
        button.focus();
      }
    });
    menu.addEventListener('focusout', function (event) {
      if (event.relatedTarget && !menu.contains(event.relatedTarget)) { openedByHover = false; setOpen(false); }
    });
    document.addEventListener('click', function (event) {
      if (!menu.contains(event.target)) { openedByHover = false; setOpen(false); }
    });
  });

  // Keep the footer year current.
  var years = document.querySelectorAll('[data-year]');
  for (var i = 0; i < years.length; i++) {
    years[i].textContent = String(new Date().getFullYear());
  }
})();
