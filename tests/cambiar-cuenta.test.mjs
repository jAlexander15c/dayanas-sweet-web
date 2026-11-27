// Cotizar: con sesión iniciada, «Usar otra cuenta» cierra la sesión y vuelve a la misma página.
// Renderiza el Liquid real de la sección; Shopify se sustituye solo en sus etiquetas y filtros propios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { registerPaginate, registerImageTag } from './helpers/shopify-liquid.mjs';

const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'orders-test-runtime.cjs'));
let Liquid;
try { ({ Liquid } = qaRequire('liquidjs')); } catch { Liquid = null; }
const rendered = (name, fn) => test(name, { skip: !Liquid && 'liquidjs no disponible' }, fn);

async function renderRequest(customer) {
  const source = readFileSync('sections/ds-celebracion-solicitud.liquid', 'utf8');
  const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const settings = Object.fromEntries(schema.settings.filter(s => s.id).map(s => [s.id, s.default ?? '']));
  const markup = source.replace(/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/, '')
    .replace(/{%-?\s*form\s+'customer'[\s\S]*?-?%}/, '<form>').replace(/{%-?\s*endform\s*-?%}/, '</form>');
  const liquid = new Liquid({ root: resolve('snippets'), extname: '.liquid' });
  registerPaginate(liquid);
  registerImageTag(liquid);
  return liquid.parseAndRender(markup, {
    section: { id: 'req', settings: { ...settings, service_enabled: true, guest_enabled: true } },
    customer,
    routes: { storefront_login_url: '/account/login', account_logout_url: '/account/logout', root_url: '/' },
    request: { path: '/pages/pasteles-personalizados' },
  });
}

rendered('Cambiar de cuenta: con sesión aparece «Usar otra cuenta», que cierra sesión y vuelve a Cotizar', async () => {
  const html = await renderRequest({ id: 9, name: 'Ana Prueba', email: 'ana@example.test' });
  assert.match(html, /Usaremos tu cuenta de Shopify: <strong>Ana Prueba<\/strong>/);
  const link = html.match(/<a [^>]*data-switch-account[^>]*>([^<]*)<\/a>/);
  assert.ok(link, 'falta el enlace para cambiar de cuenta');
  assert.equal(link[1], 'Usar otra cuenta');
  assert.match(link[0], /href="\/account\/logout\?return_url=%2Fpages%2Fpasteles-personalizados"/);
  assert.match(html, /lo que llenaste se borrará/, 'debe avisar que se pierde lo escrito');
});

rendered('Cambiar de cuenta: como invitada no aparece el enlace (no hay sesión que cerrar)', async () => {
  const html = await renderRequest(null);
  assert.doesNotMatch(html, /data-switch-account/);
  assert.doesNotMatch(html, /Usaremos tu cuenta de Shopify/);
});
