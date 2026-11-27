// Abre Chrome sin ventana con la página de prueba de Cotizar (helpers/celebracion-fixture.mjs) y devuelve ayudantes CDP.
// fixtureOptions: { guest } sin sesión, o { guest: false, guestEnabled } con sesión.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { renderFixture } from './celebracion-fixture.mjs';

export const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);

export async function openBrowser(fixtureOptions = { guest: true }) {
  const fixture = renderFixture(fixtureOptions);
  const server = createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'ds-request-browser-'));
  const child = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let socket;
  const close = () => { socket?.close(); child.kill(); server.close(); };
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await delay(100);
    assert.ok(existsSync(portFile), 'Chrome no inició');
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  } catch (error) { close(); throw error; }
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, r => r.error ? reject(Error(JSON.stringify(r.error))) : resolve(r.result)); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const mounted = async () => { for (let i = 0; i < 100; i++) { if (await evaluate('!!window.DSCelebracionSolicitud && !!document.querySelector("[data-ds-request]")?.dataset.mounted')) return; await delay(30); } };
  const open = async path => { await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}${path}` }); await delay(50); await mounted(); };
  const reload = async () => { await cdp('Page.reload'); await delay(50); await mounted(); };
  return { cdp, evaluate, open, reload, close };
}
