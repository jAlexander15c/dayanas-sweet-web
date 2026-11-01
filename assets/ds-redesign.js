(() => {
  // Delegation also covers sections replaced by the Shopify editor. Loading this
  // asset again must not register another set of document listeners.
  if (window.dsRedesignNavigation) return;
  window.dsRedesignNavigation = true;

  const dialogIds = { mobile: 'DS-R-Mobile', how: 'DS-R-How', about: 'DS-R-About', search: 'DS-R-Search' };
  const openers = new WeakMap();
  const modalFor = element => element.closest('dialog[data-ds-r-dialog]');

  const closeDialog = (dialog, restoreFocus = true) => {
    if (!dialog?.open) return;
    const opener = openers.get(dialog);
    if (opener?.getAttribute('aria-expanded') !== null) opener?.setAttribute('aria-expanded', 'false');
    if (!restoreFocus) openers.delete(dialog);
    dialog.close();
  };

  const openDialog = (name, trigger) => {
    const dialog = document.getElementById(dialogIds[name]);
    if (!dialog || dialog.open) return;
    let returnTo = trigger;
    document.querySelectorAll('dialog[data-ds-r-dialog][open]').forEach(current => {
      // A menu item becomes hidden when its mobile dialog closes. Returning to
      // the original menu toggle keeps the next dialog's focus destination visible.
      if (current.contains(returnTo)) returnTo = openers.get(current) || returnTo;
      closeDialog(current, false);
    });
    openers.set(dialog, returnTo);
    dialog.showModal();
    if (trigger.getAttribute('aria-expanded') !== null) trigger.setAttribute('aria-expanded', 'true');
  };

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest('[data-ds-r-open]');
    if (trigger) {
      event.preventDefault();
      openDialog(trigger.getAttribute('data-ds-r-open'), trigger);
      return;
    }

    const signup = event.target.closest('[data-ds-r-signup]');
    if (signup) {
      closeDialog(modalFor(signup), false);
      const email = document.getElementById('ds-r-email');
      if (email) {
        event.preventDefault();
        email.focus();
      }
      return; // Without a local email, follow the anchor's actual homepage URL.
    }

    const close = event.target.closest('[data-ds-r-close], [data-ds-r-close-link]');
    if (close) {
      closeDialog(modalFor(close), !close.hasAttribute('data-ds-r-close-link'));
      return;
    }

    if (event.target.matches('dialog[data-ds-r-dialog]')) {
      const bounds = event.target.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        closeDialog(event.target);
      }
      return;
    }

    // Dawn binds the original cart anchor directly. If an editor reload replaces
    // that anchor, delegate to the same drawer API without duplicating its click.
    const cartLink = event.target.closest('#cart-icon-bubble');
    const drawer = document.querySelector('cart-drawer');
    if (cartLink && !event.defaultPrevented && typeof drawer?.open === 'function') {
      event.preventDefault();
      drawer.open(cartLink);
    }
  });

  document.addEventListener('keydown', event => {
    if (!(event.target instanceof Element) || event.defaultPrevented) return;
    // A search field can consume Escape to clear its value before the browser
    // dispatches dialog.cancel. Close here so Escape always dismisses the modal.
    if (event.key === 'Escape' || event.code === 'Escape') {
      const dialog = modalFor(event.target);
      if (dialog?.open) {
        event.preventDefault();
        closeDialog(dialog);
      }
      return;
    }
    if (event.code !== 'Space') return;
    const cartLink = event.target.closest('#cart-icon-bubble');
    const drawer = document.querySelector('cart-drawer');
    if (cartLink && typeof drawer?.open === 'function') {
      event.preventDefault();
      drawer.open(cartLink);
    }
  });

  // cancel and close do not bubble; capture handles all current/future dialogs.
  document.addEventListener('cancel', event => {
    if (!event.target.matches('dialog[data-ds-r-dialog]')) return;
    event.preventDefault();
    closeDialog(event.target);
  }, true);

  document.addEventListener('close', event => {
    if (!event.target.matches('dialog[data-ds-r-dialog]')) return;
    const opener = openers.get(event.target);
    openers.delete(event.target);
    if (opener?.isConnected) opener.focus();
  }, true);
})();
