// Página de prueba del formulario de Cotizar: la sección Liquid con los valores por defecto del schema y un fetch simulado.
// Compartida por tests/celebracion-solicitud.test.mjs y tests/celebracion-sin-pastel.test.mjs.
import { readFileSync } from 'node:fs';

export function renderFixture({ guest = false } = {}) {
  const source = readFileSync('sections/ds-celebracion-solicitud.liquid', 'utf8');
  const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const settings = Object.fromEntries(schema.settings.filter(s => s.id).map(s => [s.id, s.default ?? '']));
  let markup = source.slice(source.indexOf('<section'), source.indexOf('{% schema %}'));
  markup = markup.replace(/data-customer="[\s\S]*?" data-customer-key/, `data-customer="${!guest}" data-customer-key`);
  markup = markup.replace(/{% if customer %}([\s\S]*?){% else %}([\s\S]*?){% endif %}/g, (_, account, visitor) => guest ? visitor : account);
  markup = markup.replace(/{% if customer %}([\s\S]*?){% endif %}/g, (_, account) => guest ? '' : account);
  markup = markup.replace(/{% unless customer %}([\s\S]*?){% endunless %}/g, (_, visitor) => guest ? visitor : '');
  markup = markup.replace(/{{ section.settings.guest_enabled }}/g, String(guest));
  markup = markup.replace(/<div class="ds-request__note" data-gate[\s\S]*?<\/div>/, '<div data-gate></div>');
  markup = markup.replace(/{% assign ds_diameters[\s\S]*?{% endfor %}/, [6, 8, 10, 12, 14, 16].map(d => `<button type="button" data-diameter="${d}" aria-pressed="${d === 8}">${d}″</button>`).join(''));
  markup = markup.replace(/{{ section.settings.tracking_page.url \| escape }}/g, '/pages/seguimiento');
  markup = markup.replace(/{{ section.settings.service_enabled }}/g, 'true');
  markup = markup.replace(/{{ section.settings.(\w+) \| escape }}/g, (_, key) => settings[key]);
  markup = markup.replace(/{{ section.id }}/g, 'test-section').replace(/{{ customer.id }}/g, '123');
  markup = markup.replace(/{{ customer.name \| escape }}/g, 'Cliente de prueba').replace(/{{ customer.email \| escape }}/g, 'prueba@example.test');
  markup = markup.replace(/{{ routes.account_login_url }}/g, '/account/login').replace(/{{ ds_login_return_url }}/g, '%2Fpages%2Fsolicitud');
  // El formulario de clientas de Shopify ({% form 'customer' %}) se reemplaza por su HTML equivalente.
  markup = markup.replace(/{%- form 'customer' -%}([\s\S]*?){%- endform -%}/, '<form method="post" action="/contact#contact_form" accept-charset="UTF-8"><input type="hidden" name="form_type" value="customer"><input type="hidden" name="utf8" value="✓">$1</form>');
  // Sin bloques de fotos, la galería no se renderiza.
  markup = markup.replace(/{%- capture ds_gallery -%}[\s\S]*?{%- if ds_gallery != blank -%}[\s\S]*?{%- endif -%}/, '');
  markup = markup.replace(/{{ routes.root_url }}/g, '/');
  markup = markup.replace(/{%[\s\S]*?%}/g, '');
  return `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${readFileSync('assets/ds-celebracion-solicitud.css', 'utf8')}</style></head><body>${markup}<script>
    window.serviceCalls = []; window.failPhoto = true; window.calendarDays = []; window.failCalendar = false;
    window.fetch = async (url, options = {}) => {
      window.serviceCalls.push({url, options});
      if (String(url).startsWith('/contact')) return {ok:true, url:'http://127.0.0.1/?customer_posted=true', json:async()=>({})};
      if (url.endsWith('/calendar')) { if(window.failCalendar)throw Error('Calendar offline'); return {ok:true, json:async()=>({days:window.calendarDays})}; }
      if (!options.method) return {ok:true, json:async()=>({requests:[]})};
      if (url.endsWith('/photos') && window.failPhoto) { window.failPhoto=false; throw Error('Offline'); }
      return {ok:true, json:async()=>({id:'browser-request-1',reference:'DS-000123',emailStatus:'failed',contact:{name:'Sofia',email:'sofia@example.test',phone:'2815550123'}})};
    };
  </script><script>${readFileSync('assets/ds-celebracion-solicitud.js', 'utf8')}</script></body></html>`;
}
