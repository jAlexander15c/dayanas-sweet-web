// Passkeys en Chrome real: autenticador virtual del navegador (CDP WebAuthn) con verificación de
// usuario, como Face ID o la huella. La página se sirve en https://dayanassweet.com/apps/inventario
// interceptada (nada sale a internet); el Worker es local con Shopify y Resend simulados.
// Uso: NODE_PATH=<carpeta con playwright> node test/passkey-ui-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
import { tocar } from './portal-nav.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/portal-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38781, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
const site = 'https://dayanassweet.com';
let browser;
try {
  browser = await chromium.launch({ ...(process.env.UI_BUNDLED_CHROMIUM ? {} : { channel: 'chrome' }), headless: true });
  const evidence = resolve(process.env.PORTAL_UI_EVIDENCE_DIR || '../../docs/inventario/evidence'), errors = [];
  await mkdir(evidence, { recursive: true });
  const api = async (path, body) => { const response = await worker.fetch(signedProxy('/proxy/api/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const embedded = (action, body) => worker.fetch('/api/staff/' + action, { method: 'POST', headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await embedded('invite', { username: 'dayana', name: 'Dayana', email: 'dayana@example.test', roles: ['admin', 'inventario'] })).status, 200);
  const emails = await (await worker.fetch('/__test/emails')).json();
  const token = new URL(emails[0].text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
  assert.equal((await api('accept-invitation', { token, password })).status, 200);

  async function newPage({ authenticator = true } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== site) return route.abort();
      if (!url.pathname.startsWith('/apps/inventario')) return route.fulfill({ status: 404, body: '' });
      const path = '/proxy' + url.pathname.slice('/apps/inventario'.length) + url.search;
      const response = await worker.fetch(signedProxy(path), { method: request.method(), headers: { 'Content-Type': request.headers()['content-type'] || 'application/json' }, ...(request.postData() ? { body: request.postData() } : {}) });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    let cdp, authenticatorId;
    if (authenticator) {
      cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable', { enableUI: false });
      ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }));
    }
    return { page, cdp, authenticatorId };
  }
  async function check(page, name) {
    for (const [label, width, height] of [['mobile', 390, 844], ['desktop', 1440, 1000]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} cabe en ${width}px`);
      const small = await page.locator('button:visible').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height < 44).map(n => n.textContent.trim()));
      assert.deepEqual(small, [], `${name}: táctiles de 44 px`);
      await page.screenshot({ path: resolve(evidence, `passkeys-${name}-${label}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const passkeyButton = page => page.getByRole('button', { name: 'Entrar con Face ID o huella', exact: true });
  const signOut = async page => { await tocar(page, 'Salir'); await passkeyButton(page).waitFor(); };

  // 1. Entrada con contraseña: el panel ofrece activar Face ID o huella; se activa en dos toques.
  const { page, cdp, authenticatorId } = await newPage();
  await page.goto(`${site}/apps/inventario`);
  await passkeyButton(page).waitFor();
  await check(page, 'entrada');
  await page.getByLabel('Usuario', { exact: true }).fill('dayana'); await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const offer = page.getByRole('region', { name: 'Entrar con Face ID o huella' });
  await offer.waitFor();
  await offer.getByRole('button', { name: 'Activar', exact: true }).click();
  await page.getByRole('heading', { name: 'Entrar con Face ID o huella' }).waitFor();
  assert.equal(await page.getByLabel('Nombre de este aparato').inputValue() !== '', true);
  await page.getByLabel('Tu contraseña').fill('no-es-la-contraseña');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByText('Contraseña incorrecta', { exact: false }).waitFor();
  await page.getByLabel('Tu contraseña').fill(password);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Activar Face ID o huella', exact: true }).click();
  await page.getByText('Listo. La próxima vez toca «Entrar con Face ID o huella».', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Aparatos activados' }).waitFor();
  const stored = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  assert.equal(stored.length, 1); assert.equal(stored[0].isResidentCredential, true); assert.equal(stored[0].rpId, 'dayanassweet.com');
  await check(page, 'activado');

  // 2. Salir y volver a entrar solo con Face ID o huella; ya no se ofrece activar.
  await signOut(page);
  await passkeyButton(page).click();
  await page.locator('#sign-out').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#staff-who').textContent().then(text => text.includes('Dayana')), true);
  assert.equal(await offer.count(), 0, 'después de entrar con Face ID no se vuelve a ofrecer');

  // 3. Si el aparato no verifica a la persona (Face ID falla), no entra y puede usar la contraseña.
  await signOut(page);
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await passkeyButton(page).click();
  await page.locator('#access-message.error').waitFor();
  assert.match(await page.locator('#access-message').textContent(), /No (pudimos entrar|se completó)/);
  assert.equal(await page.getByRole('button', { name: 'Salir', exact: true }).count(), 0);
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });

  // 4. Quitar el aparato desde el panel: esa llave deja de servir.
  await passkeyButton(page).click();
  await tocar(page, 'Face ID / huella');
  await page.getByRole('button', { name: 'Quitar', exact: true }).click();
  await page.getByText('Todavía no activaste ningún aparato.', { exact: true }).waitFor();
  await signOut(page);
  await passkeyButton(page).click();
  await page.getByText('No pudimos entrar con Face ID o huella. Entra con tu usuario y contraseña.', { exact: true }).waitFor();

  // 5. Un aparato sin Face ID ni huella: no ofrece activar y lo explica.
  const plain = await newPage({ authenticator: false });
  await plain.page.goto(`${site}/apps/inventario`);
  await plain.page.getByLabel('Usuario', { exact: true }).fill('dayana'); await plain.page.getByLabel('Contraseña', { exact: true }).fill(password);
  await plain.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await plain.page.locator('#sign-out').waitFor({ state: 'attached' });
  await tocar(plain.page, 'Face ID / huella');
  await plain.page.getByText('Este aparato no tiene Face ID, huella ni bloqueo de pantalla disponible', { exact: false }).waitFor();
  assert.equal(await plain.page.getByRole('region', { name: 'Entrar con Face ID o huella' }).count(), 0);

  assert.deepEqual(errors, [], 'sin errores JS');
  console.log('PASSKEYS UI PASS: activar en dos toques, entrar sin contraseña, rechazo sin verificación, quitar aparato, aparato sin biometría; 390/1440, 0 errores JS');
} finally {
  await browser?.close();
  await worker.stop();
}
