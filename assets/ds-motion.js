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

  function init(root) {
    root = root || document;
    initAnnouncement(root);
    initHero(root);
    initRails(root);
    initSticky(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
  document.addEventListener('shopify:section:load', function (e) { init(e.target); });
})();
