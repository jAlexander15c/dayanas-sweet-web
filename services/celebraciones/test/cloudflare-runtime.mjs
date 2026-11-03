// Run only against the local Wrangler server documented in CLOUDFLARE.md.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:8787';
const secret = 'test-only-not-a-real-key', shop = 'test-bakery.myshopify.com';
function proxy(path, method = 'GET', body, customerId = '1') {
  const url = new URL(`${base}/proxy${path}`);
  for (const [k,v] of Object.entries({ shop, logged_in_customer_id: customerId, path_prefix: '/apps/celebraciones', timestamp: String(Math.floor(Date.now()/1000)) })) url.searchParams.set(k,v);
  const message = [...url.searchParams].map(([k,v]) => `${k}=${v}`).sort().join('');
  url.searchParams.set('signature', createHmac('sha256',secret).update(message).digest('hex'));
  return fetch(url, { method, headers: { Origin: 'https://bakery.test', 'Content-Type':'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function admin(path, body) {
  const now = Math.floor(Date.now()/1000), header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const claims = Buffer.from(JSON.stringify({aud:'test-app',sub:'9',dest:`https://${shop}`,iss:`https://${shop}/admin`,iat:now,nbf:now,exp:now+60})).toString('base64url');
  const token = `${header}.${claims}.${createHmac('sha256',secret).update(`${header}.${claims}`).digest('base64url')}`;
  return fetch(`${base}/admin${path}`, { method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body) });
}
async function success(response) { assert.equal(response.status,200,await response.clone().text()); return response.json(); }
const pickupDate = new Date(Date.now() + 8 * 86400000);
pickupDate.setUTCHours(18, 0, 0, 0);
const created = await success(await proxy('/requests','POST',{input:{requestText:'Prueba local de Cloudflare',pickup:{label:'Recogida de prueba'},details:{pickupAt:pickupDate.toISOString(),urgent:false,tiers:[{diameter:8,sponges:['Vainilla','Chocolate'],fillings:['Guayaba','Nutella']}],coating:'Buttercream',decorations:['Flores de fondant']}},operationId:randomUUID()}));
assert.equal((await proxy(`/requests/${created.id}`,'GET',undefined,'2')).status,404);
const comment = {text:'Flores de fondant',operationId:randomUUID()};
await Promise.all(Array.from({length:4},()=>proxy(`/requests/${created.id}/comments`,'POST',comment).then(success)));
const read = await success(await proxy(`/requests/${created.id}`)); assert.equal(read.comments.length,1);
const proposal = {baseCents:15000,surchargeCents:2000,display:'breakdown',canPrepare:'Pastel rosa',changes:'Flores en fondant',reply:'Propuesta de prueba'};
const p = await success(await admin(`/requests/${created.id}/proposals`,{proposal,operationId:randomUUID()}));
assert.equal(p.pendingProposal.totalCents,17000);
const accepted = await success(await proxy(`/requests/${created.id}/accept`,'POST',{proposalVersion:p.pendingProposal.version,operationId:randomUUID()}));
assert.equal(accepted.acceptedProposal.totalCents,17000); assert.equal(accepted.status,'quoted'); assert.deepEqual(accepted.payments,[]);
assert.equal((await proxy(`/requests/${created.id}/accept`,'POST',{proposalVersion:p.pendingProposal.version,operationId:randomUUID()})).status,409);
assert.equal((await fetch(`${base}/proxy/requests/${created.id}`)).status,401);
console.log('Cloudflare local: creación, aislamiento, 4 reintentos concurrentes, propuesta, aceptación, conflicto y firma: OK.');
