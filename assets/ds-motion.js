/* Dayana's Sweet: movimiento e interacción de la capa DS. Sin dependencias. */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var resources = new Map();
  function keep(el, dispose) {
    var section = el.closest('.shopify-section') || el;
    if (!resources.has(section)) resources.set(section, []);
    resources.get(section).push(dispose);
  }
  function listen(el, target, name, handler) {
    target.addEventListener(name, handler);
    keep(el, function () { target.removeEventListener(name, handler); });
  }
  function cleanup(root) {
    // Solo se liberan los recursos (incluidos timers de feedback) de la sección afectada.
    resources.forEach(function (disposers, section) {
      if (section !== root && !root.contains(section)) return;
      disposers.forEach(function (dispose) { dispose(); });
      resources.delete(section);
    });
  }

  function initAnnouncement(root) {
    root.querySelectorAll('[data-ds-rotate]').forEach(function (bar) {
      if (bar.dsInit) return;
      bar.dsInit = true;
      keep(bar, function () { bar.dsInit = false; });
      var msgs = bar.querySelectorAll('.ds-announce__msg');
      if (!msgs.length) return;
      var control = bar.querySelector('[data-ds-pause]');
      var paused = reduce.matches;
      var i = 0;
      var ms = (parseInt(bar.dataset.dsRotate, 10) || 5) * 1000;
      var timer;
      function show(n) {
        i = (n + msgs.length) % msgs.length;
        msgs.forEach(function (msg, index) {
          var active = index === i;
          msg.classList.toggle('is-on', active);
          msg.hidden = !active;
          msg.inert = !active;
          msg.setAttribute('aria-hidden', String(!active));
        });
      }
      function start() {
        clearInterval(timer);
        if (paused || reduce.matches || msgs.length < 2) return;
        timer = setInterval(function () { if (!document.hidden) show(i + 1); }, ms);
      }
      function updateControl() {
        if (!control) return;
        control.disabled = reduce.matches;
        control.setAttribute('aria-pressed', String(paused));
        control.textContent = reduce.matches ? 'Movimiento pausado' : paused ? 'Reanudar' : 'Pausar';
      }
      show(0);
      updateControl();
      start();
      keep(bar, function () { clearInterval(timer); });
      if (control) listen(bar, control, 'click', function () { paused = !paused; updateControl(); start(); });
      listen(bar, reduce, 'change', function () { if (reduce.matches) paused = true; updateControl(); start(); });
    });
  }

  function initHero(root) {
    root.querySelectorAll('[data-ds-hero]').forEach(function (hero) {
      if (hero.dsInit) return;
      hero.dsInit = true;
      keep(hero, function () { hero.dsInit = false; });
      var slides = hero.querySelectorAll('[data-ds-slide]');
      var imgs = hero.querySelectorAll('.ds-hero__img');
      var dots = hero.querySelectorAll('[data-ds-dot]');
      var control = hero.querySelector('[data-ds-pause]');
      if (!slides.length) return;
      var i = 0;
      var timer;
      var focusTimer;
      var warmTimers = new Set();
      var warmQueued = new Set();
      var paused = reduce.matches;
      var suspended = false;
      var ms = (parseInt(hero.dataset.interval, 10) || 6) * 1000;
      hero.style.setProperty('--ds-interval', ms + 'ms');

      // Warm the next slide after the current image loads, without competing with LCP.
      function warmNext() {
        if (imgs.length < 2) return;
        var current = imgs[i];
        var next = imgs[(i + 1) % imgs.length];
        if (!next || next.loading !== 'lazy' || warmQueued.has(next)) return;
        warmQueued.add(next);
        function queue() {
          var warmTimer = setTimeout(function () {
            warmTimers.delete(warmTimer);
            if (!hero.isConnected) return;
            next.fetchPriority = 'low';
            next.loading = 'eager';
          }, 200);
          warmTimers.add(warmTimer);
        }
        if (current && !current.complete) {
          listen(hero, current, 'load', queue);
          listen(hero, current, 'error', queue);
        } else {
          queue();
        }
      }

      function show(n) {
        i = (n + slides.length) % slides.length;
        if (imgs[i]) imgs[i].loading = 'eager';
        slides.forEach(function (s, k) {
          s.classList.toggle('is-on', k === i);
          s.setAttribute('aria-hidden', String(k !== i));
          s.inert = k !== i;
        });
        imgs.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
        dots.forEach(function (d, k) {
          d.classList.remove('is-on', 'is-done');
          void d.offsetWidth;
          if (k < i) d.classList.add('is-done');
          if (k === i) d.classList.add('is-on');
          if (k === i) d.setAttribute('aria-current', 'true');
          else d.removeAttribute('aria-current');
        });
        schedule();
        warmNext();
      }
      function schedule() {
        clearTimeout(timer);
        if (reduce.matches || paused || suspended || document.hidden || slides.length < 2) return;
        timer = setTimeout(function () { show(i + 1); }, ms);
      }
      function updateControl() {
        hero.classList.toggle('is-paused', paused || suspended || reduce.matches);
        if (!control) return;
        control.disabled = reduce.matches;
        control.setAttribute('aria-pressed', String(paused));
        control.textContent = reduce.matches ? 'Movimiento pausado' : paused ? 'Reanudar' : 'Pausar';
      }
      function suspend(value) { suspended = value; updateControl(); schedule(); }
      dots.forEach(function (d) {
        listen(hero, d, 'click', function () { show(parseInt(d.dataset.dsDot, 10)); });
      });
      if (control) listen(hero, control, 'click', function () { paused = !paused; updateControl(); schedule(); });
      listen(hero, hero, 'mouseenter', function () { suspend(true); });
      listen(hero, hero, 'mouseleave', function () { suspend(hero.matches(':focus-within')); });
      listen(hero, hero, 'focusin', function () { suspend(true); });
      listen(hero, hero, 'focusout', function () {
        clearTimeout(focusTimer);
        focusTimer = setTimeout(function () { if (hero.isConnected) suspend(hero.matches(':hover, :focus-within')); }, 0);
      });
      listen(hero, document, 'visibilitychange', schedule);
      listen(hero, reduce, 'change', function () { if (reduce.matches) paused = true; updateControl(); schedule(); });
      listen(hero, hero, 'shopify:block:select', function (e) {
        var idx = Array.prototype.indexOf.call(slides, e.target);
        if (idx > -1) { paused = true; updateControl(); show(idx); }
      });
      keep(hero, function () {
        clearTimeout(timer);
        clearTimeout(focusTimer);
        warmTimers.forEach(function (warmTimer) { clearTimeout(warmTimer); });
        warmTimers.clear();
      });
      updateControl();
      show(0);
    });
  }

  function initRails(root) {
    root.querySelectorAll('[data-ds-rail]').forEach(function (btn) {
      if (btn.dsInit) return;
      btn.dsInit = true;
      keep(btn, function () { btn.dsInit = false; });
      listen(btn, btn, 'click', function () {
        var rail = document.getElementById(btn.dataset.dsRail);
        if (!rail) return;
        rail.scrollBy({ left: parseInt(btn.dataset.dir, 10) * rail.clientWidth * 0.8, behavior: reduce.matches ? 'auto' : 'smooth' });
      });
    });
  }

  function initSticky(root) {
    root.querySelectorAll('[data-ds-sticky]').forEach(function (bar) {
      if (bar.dsInit) return;
      if (bar.closest('quick-add-modal')) return;
      bar.dsInit = true;
      keep(bar, function () { bar.dsInit = false; });
      var info = bar.closest('.product__info-container') || document;
      var form = info.querySelector('form[data-type="add-to-cart-form"]');
      var submit = form && form.querySelector('[type="submit"][name="add"]');
      if (!submit) return;
      var stickySubmit = bar.querySelector('[data-ds-sticky-submit]');
      if (stickySubmit) listen(bar, stickySubmit, 'click', function () { if (!stickySubmit.disabled) submit.click(); });
      if (!('IntersectionObserver' in window)) return;
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var below = en.boundingClientRect.top < 0;
          bar.hidden = en.isIntersecting || !below || submit.disabled || (stickySubmit && stickySubmit.disabled);
        });
      });
      observer.observe(submit);
      keep(bar, function () { observer.disconnect(); });
    });
  }


  var REVEAL = '.ds-rail__head, .ds-rail > li, .ds-batch__title, .ds-batch__intro, .ds-step, .ds-cats__title, .ds-tile, .ds-season__copy, .ds-season__cards > li, .ds-story__img, .ds-story__copy, .ds-social__copy, .ds-insta > *, .ds-faq__side, .ds-qa, .product-grid .grid__item';
  function revealAll() {
    document.querySelectorAll('.ds-reveal:not(.is-in)').forEach(function (el) { el.classList.add('is-in'); });
  }
  var revealGuards = false;
  function initRevealGuards() {
    if (revealGuards) return;
    revealGuards = true;
    // Nada queda en opacidad 0: al imprimir, y al llegar al final de la página
    // (los últimos elementos pueden no cruzar nunca el margen inferior del observer).
    window.addEventListener('beforeprint', revealAll);
    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var doc = document.documentElement;
        if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) revealAll();
      });
    }, { passive: true });
  }
  function initReveal(root) {
    if (reduce.matches || !('IntersectionObserver' in window)) { revealAll(); return; }
    document.documentElement.classList.add('ds-js');
    initRevealGuards();
    var elements = root.querySelectorAll(REVEAL);
    if (!elements.length) return;
    var observers = new Map();
    elements.forEach(function (el) {
      // The first product row can be visible at load; keep it paintable for LCP.
      if (el.matches('.product-grid .grid__item:nth-child(-n+2)')) return;
      // Dawn ya anima estos elementos: evitar la doble animación.
      if (el.closest('.scroll-trigger')) return;
      if (el.classList.contains('is-in')) return;
      var i = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.setProperty('--ds-delay', Math.min(i, 4) * 50 + 'ms');
      el.classList.add('ds-reveal');
      // Ya pasó por encima del viewport (p. ej. scroll restaurado): mostrar sin esperar al observer.
      if (el.getBoundingClientRect().bottom <= 0) { el.classList.add('is-in'); return; }
      var section = el.closest('.shopify-section') || el;
      if (!observers.has(section)) {
        var observer = new IntersectionObserver(function (entries, currentObserver) {
          entries.forEach(function (en) {
            if (!en.isIntersecting && en.boundingClientRect.bottom > 0) return;
            en.target.classList.add('is-in');
            currentObserver.unobserve(en.target);
          });
        }, { rootMargin: '0px 0px -6% 0px' });
        observers.set(section, observer);
        keep(el, observer.disconnect.bind(observer));
      }
      observers.get(section).observe(el);
    });
  }

  // Cuenta regresiva al cierre de la tanda. Solo informa; el checkout lo controla Shopify.
  function initCountdown(root) {
    root.querySelectorAll('[data-ds-countdown]').forEach(function (box) {
      if (box.dsInit) return;
      box.dsInit = true;
      keep(box, function () { box.dsInit = false; });
      var raw = String(box.dataset.dsCountdown || '').trim();
      var end = /^\d+$/.test(raw) ? parseInt(raw, 10) * 1000 : Date.parse(raw);
      if (isNaN(end)) return;
      var units = {};
      box.querySelectorAll('[data-unit]').forEach(function (el) { units[el.dataset.unit] = el; });
      var labels = {};
      box.querySelectorAll('[data-unit-label]').forEach(function (el) { labels[el.dataset.unitLabel] = el; });
      var label = box.querySelector('.ds-countdown__label');
      var timerEl = box.querySelector('.ds-countdown__units');
      var done = box.querySelector('[data-ds-countdown-done]');
      var timer;
      function set(el, value) {
        if (!el || el.textContent === value) return;
        el.textContent = value;
        if (reduce.matches) return;
        el.classList.remove('is-tick');
        void el.offsetWidth;
        el.classList.add('is-tick');
      }
      function word(n, one, other) { return n === 1 ? one : other; }
      function setLabel(key, n) {
        var el = labels[key];
        if (!el) return;
        var text = n === 1 ? el.dataset.one : el.dataset.other;
        if (text != null && el.textContent !== text) el.textContent = text;
      }
      function finish() {
        box.hidden = false;
        if (label) label.hidden = true;
        if (timerEl) { timerEl.hidden = true; timerEl.removeAttribute('aria-label'); }
        if (done) done.hidden = false;
      }
      function tick() {
        var left = end - Date.now();
        if (left <= 0) { finish(); return; }
        box.hidden = false;
        if (done) done.hidden = true;
        var mins = Math.floor(left / 60000);
        var d = Math.floor(mins / 1440);
        var h = Math.floor(mins / 60) % 24;
        var m = mins % 60;
        set(units.d, String(d));
        set(units.h, String(h).padStart(2, '0'));
        set(units.m, String(m).padStart(2, '0'));
        setLabel('d', d);
        setLabel('h', h);
        setLabel('m', m);
        if (timerEl) {
          timerEl.setAttribute('aria-label', 'Faltan ' + d + ' ' + word(d, 'día', 'días') + ', ' + h + ' ' + word(h, 'hora', 'horas') + ' y ' + m + ' ' + word(m, 'minuto', 'minutos') + ' para el cierre de pedidos');
        }
        timer = setTimeout(tick, (left % 60000) + 50);
      }
      tick();
      keep(box, function () { clearTimeout(timer); });
    });
  }

  // Último formulario de tarjeta enviado: el feedback (éxito o error) se aplica a ese.
  var lastCardForm = null;
  function cardVariant(form) {
    var input = form && form.querySelector('input[name="id"]');
    return input ? String(input.value) : '';
  }
  function cardFor(event) {
    if (!lastCardForm || !lastCardForm.isConnected) return null;
    if (event && event.productVariantId != null && String(event.productVariantId) !== cardVariant(lastCardForm)) return null;
    return lastCardForm;
  }
  function cardErrorText(event) {
    var parts = [];
    if (event) {
      if (event.message) parts.push(event.message);
      if (typeof event.errors === 'string') parts.push(event.errors);
      else if (event.errors && typeof event.errors === 'object') {
        Object.keys(event.errors).forEach(function (k) { parts.push(String(event.errors[k])); });
      }
    }
    var text = parts.join(' ');
    var status = event && parseInt(event.status, 10);
    if (status === 422 || /stock|available|disponib|sold.?out|agotad|inventar|inventory|quedan|in your cart|en tu carrito|en el carrito/i.test(text)) {
      return 'Ya no quedan cupos de este producto.';
    }
    return (event && typeof event.errors === 'string' && event.errors) || (event && event.message) || 'No pudimos agregarlo. Intenta de nuevo.';
  }

  function initCartFeedback() {
    if (window.dsCartFeedback) return;
    window.dsCartFeedback = true;
    document.addEventListener('submit', function (e) {
      var form = e.target;
      lastCardForm = form && form.closest && form.closest('.ds-card__form') ? form : null;
      if (!lastCardForm) return;
      var wrap = form.closest('.ds-card__form');
      var box = wrap && wrap.querySelector('[data-ds-card-error]');
      if (box) { box.hidden = true; box.textContent = ''; }
    }, true);
    if (typeof subscribe !== 'function' || typeof PUB_SUB_EVENTS === 'undefined') return;
    subscribe(PUB_SUB_EVENTS.cartUpdate, function (event) {
      if (!event || event.source !== 'product-form') return;
      var form = cardFor(event);
      var btn = form && form.querySelector('.ds-add');
      if (btn && !btn.classList.contains('is-added')) {
        var label = btn.querySelector('span');
        var path = btn.querySelector('.ds-ico path');
        var prev = label ? label.textContent : '';
        var prevPath = path ? path.getAttribute('d') : '';
        btn.classList.add('is-added');
        if (label) label.textContent = 'Agregado';
        if (path) path.setAttribute('d', 'M5 12l5 5L20 7');
        var addedTimer = setTimeout(function () {
          btn.classList.remove('is-added');
          if (label) label.textContent = prev;
          if (path) path.setAttribute('d', prevPath);
        }, 1600);
        keep(btn, function () { clearTimeout(addedTimer); });
      }
      setTimeout(function () {
        document.querySelectorAll('.cart-count-bubble').forEach(function (b) {
          b.classList.remove('ds-bump');
          void b.offsetWidth;
          if (!reduce.matches) b.classList.add('ds-bump');
        });
      }, 350);
    });
    if (!PUB_SUB_EVENTS.cartError) return;
    subscribe(PUB_SUB_EVENTS.cartError, function (event) {
      if (!event || event.source !== 'product-form') return;
      var form = cardFor(event);
      var wrap = form && form.closest('.ds-card__form');
      var box = wrap && wrap.querySelector('[data-ds-card-error]');
      if (!box) return;
      clearTimeout(box.dsTimer);
      box.textContent = cardErrorText(event);
      box.hidden = false;
      box.dsTimer = setTimeout(function () { box.hidden = true; }, 5000);
      keep(box, function () { clearTimeout(box.dsTimer); });
    });
  }

  function init(root) {
    root = root || document;
    [initAnnouncement, initHero, initRails, initSticky, initReveal, initCountdown].forEach(function (fn) {
      try { fn(root); } catch (err) { console.error(err); }
    });
    try { initCartFeedback(); } catch (err) { console.error(err); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
  document.addEventListener('shopify:section:load', function (e) { cleanup(e.target); init(e.target); });
  document.addEventListener('shopify:section:unload', function (e) { cleanup(e.target); });
})();
