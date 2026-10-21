/* Keyboard access for existing dialogs. Business actions stay with each page. */
(function () {
  'use strict';
  var active = null, previousFocus = null, nextId = 0, pending = false;
  var focusable = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
  function visible(el) { return !!el && !el.closest('[hidden],.hidden') && el.getClientRects().length > 0; }
  function items(dialog) { return Array.from(dialog.querySelectorAll(focusable)).filter(visible); }
  function sync() {
    pending = false;
    var dialogs = Array.from(document.querySelectorAll('.modalwrap,.overlay')).filter(visible);
    var top = dialogs.length ? dialogs[dialogs.length - 1] : null;
    if (top === active) return;
    if (top) {
      if (!active) previousFocus = document.activeElement;
      active = top;
      top.setAttribute('role', 'dialog'); top.setAttribute('aria-modal', 'true');
      var heading = top.querySelector('h1,h2,h3');
      if (heading && !top.hasAttribute('aria-label') && !top.hasAttribute('aria-labelledby')) {
        if (!heading.id) heading.id = 'dialog-title-' + (++nextId);
        top.setAttribute('aria-labelledby', heading.id);
      }
      if (!top.contains(document.activeElement)) {
        var first = items(top)[0];
        if (first) first.focus(); else { top.tabIndex = -1; top.focus(); }
      }
    } else {
      if (active) active.removeAttribute('aria-modal');
      active = null;
      if (visible(previousFocus)) previousFocus.focus();
      previousFocus = null;
    }
  }
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab' || !active || !visible(active)) return;
    var list = items(active), first = list[0], last = list[list.length - 1];
    if (!list.length) { event.preventDefault(); active.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !active.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  var observer = new MutationObserver(function (changes) {
    if (pending || !changes.some(function (change) {
      return change.target.matches && change.target.matches('.modalwrap,.overlay');
    })) return;
    pending = true; queueMicrotask(sync);
  });
  observer.observe(document.body, {subtree:true,attributes:true,attributeFilter:['class','hidden']});
  document.querySelectorAll('input[type="search"]').forEach(function (input) {
    if (!input.hasAttribute('aria-label') && !input.labels.length) input.setAttribute('aria-label', input.placeholder || 'ค้นหา');
  });
  document.querySelectorAll('.wcag-skip,.skip-link').forEach(function (link) {
    var id = (link.getAttribute('href') || '').slice(1);
    if (!id || document.getElementById(id)) return;
    var main = document.querySelector('main,.wrap,.layout,.page:not(.hidden),.pwrap');
    if (main) { main.id = id; main.tabIndex = -1; }
  });
  sync();
})();
