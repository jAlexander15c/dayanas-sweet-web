// Página de prueba del formulario de Cotizar: la sección Liquid real (renderizada con liquidjs, valores por defecto
// del schema) y un fetch simulado. Compartida por las pruebas de navegador de Cotizar.
// guest: sin sesión (invitada). Con sesión, guestEnabled decide si se ofrece «Enviar con otro nombre y correo».
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export function renderFixture({ guest = false, guestEnabled = guest } = {}) {
  const { Liquid } = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'orders-test-runtime.cjs'))('liquidjs');
  const source = readFileSync('sections/ds-celebracion-solicitud.liquid', 'utf8');
  const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const settings = Object.fromEntries(schema.settings.filter(s => s.id).map(s => [s.id, s.default ?? '']));
  let markup = source.slice(source.indexOf('<section'), source.indexOf('{% schema %}'));
  // El formulario de clientas de Shopify ({% form 'customer' %}) se reemplaza por su HTML equivalente.
  markup = markup.replace(/{%- form 'customer' -%}([\s\S]*?){%- endform -%}/, '<form method="post" action="/contact#contact_form" accept-charset="UTF-8"><input type="hidden" name="form_type" value="customer"><input type="hidden" name="utf8" value="✓">$1</form>');
  let html = new Liquid().parseAndRenderSync(markup, {
    section: { id: 'test-section', blocks: [], settings: { ...settings, service_enabled: true, guest_enabled: guestEnabled, tracking_page: { url: '/pages/seguimiento' } } },
    customer: guest ? null : { id: 123, name: 'Cliente de prueba', email: 'prueba@example.test' },
    routes: { root_url: '/', storefront_login_url: '/account/login', account_logout_url: '/account/logout' },
    request: { path: '/pages/solicitud' },
  });
  html = html.replace(/<div class="ds-request__note" data-gate[\s\S]*?<\/div>/, '<div data-gate></div>');
  return `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${readFileSync('assets/ds-celebracion-solicitud.css', 'utf8')}</style></head><body>${html}<script>
    window.serviceCalls = []; window.failPhoto = true; window.calendarDays = []; window.failCalendar = false;
    // ?fallar-envio=1: la primera creación de la solicitud se corta (una sola vez por pestaña, también tras recargar).
    window.failCreate = location.search.includes('fallar-envio') && !sessionStorage.getItem('ds-test-create-failed');
    window.fetch = async (url, options = {}) => {
      window.serviceCalls.push({url, options});
      if (String(url).endsWith('/guest/requests') && window.failCreate) { window.failCreate = false; sessionStorage.setItem('ds-test-create-failed', '1'); throw Error('Offline'); }
      if (String(url).startsWith('/contact')) return {ok:true, url:'http://127.0.0.1/?customer_posted=true', json:async()=>({})};
      if (url.endsWith('/calendar')) { if(window.failCalendar)throw Error('Calendar offline'); return {ok:true, json:async()=>({days:window.calendarDays})}; }
      if (!options.method) return {ok:true, json:async()=>({requests:[]})};
      if (url.endsWith('/photos') && window.failPhoto) { window.failPhoto=false; throw Error('Offline'); }
      return {ok:true, json:async()=>({id:'browser-request-1',reference:'DS-000123',emailStatus:'failed',contact:{name:'Sofia',email:'sofia@example.test',phone:'2815550123'}})};
    };
  </script><script>${readFileSync('assets/ds-celebracion-solicitud.js', 'utf8')}</script></body></html>`;
}
