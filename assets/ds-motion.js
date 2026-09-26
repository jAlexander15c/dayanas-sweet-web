/* Dayana's Sweet: movimiento e interacción de la capa DS. Sin dependencias. */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function initAnnouncement(root) {
    root.querySelectorAll('[data-ds-rotate]').forEach(function (bar) {
      if (bar.dsInit) return;
      bar.dsInit = true;
      var msgs = bar.querySelectorAll('.ds-announce__msg');
      if (msgs.length < 2 || reduce.matches) return;
      var i = 0;
      var ms = (parseInt(bar.dataset.dsRotate, 10) || 5) * 1000;
      bar.dsTimer = setInterval(function () {
        if (document.hidden) return;
        msgs[i].classList.remove('is-on');
        i = (i + 1) % msgs.length;
        msgs[i].classList.add('is-on');
      }, ms);
    });
  }

  function initHero(root) {
    root.querySelectorAll('[data-ds-hero]').forEach(function (hero) {
      if (hero.dsInit) return;
      hero.dsInit = true;
      var slides = hero.querySelectorAll('[data-ds-slide]');
      var imgs = hero.querySelectorAll('.ds-hero__img');
      var dots = hero.querySelectorAll('[data-ds-dot]');
      if (slides.length < 2) return;
      var i = 0;
      var timer;
      var ms = (parseInt(hero.dataset.interval, 10) || 6) * 1000;
      hero.style.setProperty('--ds-interval', ms + 'ms');

      function show(n) {
        i = (n + slides.length) % slides.length;
        slides.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
        imgs.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
        dots.forEach(function (d, k) {
          d.classList.remove('is-on', 'is-done');
          void d.offsetWidth;
          if (k < i) d.classList.add('is-done');
          if (k === i) d.classList.add('is-on');
        });
        schedule();
      }
      function schedule() {
        clearTimeout(timer);
        if (reduce.matches || hero.dsPaused) return;
        timer = setTimeout(function () { show(i + 1); }, ms);
      }
      function pause(p) {
        hero.dsPaused = p;
        hero.classList.toggle('is-paused', p);
        if (p) clearTimeout(timer); else schedule();
      }
      dots.forEach(function (d) {
        d.addEventListener('click', function () { show(parseInt(d.dataset.dsDot, 10)); });
      });
      hero.addEventListener('mouseenter', function () { pause(true); });
      hero.addEventListener('mouseleave', function () { pause(false); });
      hero.addEventListener('focusin', function () { pause(true); });
      hero.addEventListener('focusout', function () { pause(false); });
      document.addEventListener('visibilitychange', function () { pause(document.hidden); });
      hero.addEventListener('shopify:block:select', function (e) {
        var idx = Array.prototype.indexOf.call(slides, e.target);
        if (idx > -1) { pause(true); show(idx); }
      });
      show(0);
    });
  }

  function initRails(root) {
    root.querySelectorAll('[data-ds-rail]').forEach(function (btn) {
      if (btn.dsInit) return;
      btn.dsInit = true;
      btn.addEventListener('click', function () {
        var rail = document.getElementById(btn.dataset.dsRail);
        if (!rail) return;
        rail.scrollBy({ left: parseInt(btn.dataset.dir, 10) * rail.clientWidth * 0.8, behavior: reduce.matches ? 'auto' : 'smooth' });
      });
    });
  }

  function initSticky(root) {
    root.querySelectorAll('[data-ds-sticky]').forEach(function (bar) {
      if (bar.dsInit) return;
      bar.dsInit = true;
      var info = bar.closest('.product__info-container') || document;
      var form = info.querySelector('form[data-type="add-to-cart-form"]');
      var submit = form && form.querySelector('[type="submit"][name="add"]');
      if (!submit) return;
      bar.querySelector('[data-ds-sticky-submit]').addEventListener('click', function () {
        submit.click();
      });
      if (!('IntersectionObserver' in window)) return;
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var below = en.boundingClientRect.top < 0;
          bar.hidden = en.isIntersecting || !below;
        });
      }).observe(submit);
    });
  }


  var REVEAL = '.ds-rail__head, .ds-rail > li, .ds-batch__title, .ds-batch__intro, .ds-step, .ds-cats__title, .ds-tile, .ds-season__copy, .ds-season__cards > li, .ds-story__img, .ds-story__copy, .ds-social__copy, .ds-insta > *, .ds-faq__side, .ds-qa, .product-grid .grid__item';
  function initReveal(root) {
    if (reduce.matches || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('ds-js');
    if (!window.dsRevealIO) {
      window.dsRevealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.classList.add('is-in');
          window.dsRevealIO.unobserve(en.target);
        });
      }, { rootMargin: '0px 0px -6% 0px' });
    }
    root.querySelectorAll(REVEAL).forEach(function (el) {
      if (el.classList.contains('ds-reveal')) return;
      var i = Array.prototype.indexOf.call(el.parentElement.children, el);
      el.style.setProperty('--ds-delay', Math.min(i, 6) * 60 + 'ms');
      el.classList.add('ds-reveal');
      window.dsRevealIO.observe(el);
    });
  }

  function initCartFeedback() {
    if (window.dsCartFeedback || typeof subscribe !== 'function' || typeof PUB_SUB_EVENTS === 'undefined') return;
    window.dsCartFeedback = true;
    subscribe(PUB_SUB_EVENTS.cartUpdate, function (event) {
      if (!event || event.source !== 'product-form') return;
      var input = document.querySelector('.ds-card__form input[name="id"][value="' + event.productVariantId + '"]');
      var btn = input && input.form.querySelector('.ds-add');
      if (btn && !btn.classList.contains('is-added')) {
        var label = btn.querySelector('span');
        var prev = label ? label.textContent : '';
        btn.classList.add('is-added');
        if (label) label.textContent = 'Agregado';
        setTimeout(function () {
          btn.classList.remove('is-added');
          if (label) label.textContent = prev;
        }, 1600);
      }
      setTimeout(function () {
        document.querySelectorAll('.cart-count-bubble').forEach(function (b) {
          b.classList.remove('ds-bump');
          void b.offsetWidth;
          if (!reduce.matches) b.classList.add('ds-bump');
        });
      }, 350);
    });
  }

  function init(root) {
    root = root || document;
    initAnnouncement(root);
    initHero(root);
    initRails(root);
    initSticky(root);
    initReveal(root);
    initCartFeedback();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
  document.addEventListener('shopify:section:load', function (e) { init(e.target); });
})();
