import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createStore } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
const config = { secret: 'test-only-not-a-real-key', shop: 'test-bakery.myshopify.com', clientId: 'test-app', storefrontOrigin: 'https://bakery.test', staffIds: ['9'] };
function signed(path, customer = '1', method = 'GET', body) {
  const url = new URL(`https://backend.test/proxy${path}`);
  url.searchParams.set('shop', config.shop); url.searchParams.set('logged_in_customer_id', customer); url.searchParams.set('path_prefix', '/apps/celebraciones'); url.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)));
  const plain = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('');
  url.searchParams.set('signature', createHmac('sha256', config.secret).update(plain).digest('hex'));
  return new Request(url, { method, headers: { 'Content-Type': 'application/json', Origin: config.storefrontOrigin }, body: body ? JSON.stringify(body) : undefined });
}
test('test rollout permits only configured signed customers and empty list fails closed', async () => {
  const store = createStore(':memory:');
  try {
    const handler = createHandler({ store, config: { ...config, testCustomerIds: ['1'] } });
    assert.equal((await handler(signed('/requests', '1'))).status, 200);
    assert.equal((await handler(signed('/requests', '2'))).status, 503);
    const closed = createHandler({ store, config: { ...config, testCustomerIds: [] } });
    assert.equal((await closed(signed('/requests', '1'))).status, 503);
  } finally { store.close(); }
});
test('HTTP create/read/comments retain owner isolation and return no-store', async () => {
  const store = createStore(':memory:'); const handler = createHandler({ store, config });
  try {
    const created = await handler(signed('/requests', '1', 'POST', { input: { requestText: 'Rosa', pickup: { label: '14 noviembre' } }, operationId: 'create-1' }));
    assert.equal(created.status, 200); assert.equal(created.headers.get('cache-control'), 'no-store'); const snapshot = await created.json();
    assert.equal((await handler(signed(`/requests/${snapshot.id}`, '2'))).status, 404);
    const commented = await handler(signed(`/requests/${snapshot.id}/comments`, '1', 'POST', { text: 'Flores', operationId: 'comment-1' }));
    assert.equal(commented.status, 200); assert.equal((await commented.json()).comments.length, 1);
  } finally { store.close(); }
});
test('HTTP rejects unsigned requests, cross-origin mutation and oversized body', async () => {
  const store = createStore(':memory:'); const handler = createHandler({ store, config });
  try {
    assert.equal((await handler(new Request('https://backend.test/proxy/requests/x'))).status, 401);
    const other = signed('/requests', '1', 'POST', { input: {}, operationId: 'x' }); other.headers.set('Origin', 'https://attacker.test');
    assert.equal((await handler(other)).status, 403);
    assert.equal((await handler(signed('/requests', '1', 'POST', { value: 'x'.repeat(40000) }))).status, 413);
  } finally { store.close(); }
});
test('HTTP never accepts client supplied payments or actor', async () => {
  const store = createStore(':memory:'); const handler = createHandler({ store, config });
  try {
    const request = signed('/requests', '1', 'POST', { input: { requestText: 'Pastel', pickup: { label: '14 noviembre' } }, operationId: 'create-2', actor: { role: 'staff' }, payments: [{ amountCents: 9000 }] });
    assert.equal((await handler(request)).status, 422);
    assert.equal((await handler(signed('/requests/x/payments', '1', 'POST', { amountCents: 9000 }))).status, 404);
  } finally { store.close(); }
});
function staff(path, staffId, body) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const data = Buffer.from(JSON.stringify({ aud: config.clientId, sub: staffId, dest: `https://${config.shop}`, iss: `https://${config.shop}/admin`, iat: now, nbf: now, exp: now + 60 })).toString('base64url');
  const signature = createHmac('sha256', config.secret).update(`${head}.${data}`).digest('base64url');
  return new Request(`https://backend.test/admin${path}`, { method: 'POST', headers: { Authorization: `Bearer ${head}.${data}.${signature}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
test('admin paginates and searches requests while notification retry remains staff-only',async()=>{
 const store=createStore(':memory:'),handler=createHandler({store,config}),actor={shop:config.shop,role:'staff',staffId:'9'};
 const get=path=>{const authenticated=staff(path,'9',{});return new Request(authenticated.url,{headers:authenticated.headers});};
 try{
  let oldest;for(let i=0;i<101;i++){const request=store.createRequest({shop:config.shop,customerId:String(i+1)},{requestText:'Pastel',pickup:{label:'Houston'}},'create');oldest??=request;}
  const first=await(await handler(get('/requests'))).json();assert.equal(first.requests.length,50);assert.ok(first.nextCursor);
  const second=await(await handler(get('/requests?cursor='+first.nextCursor))).json();assert.equal(second.requests.length,50);
  const third=await(await handler(get('/requests?cursor='+second.nextCursor))).json();assert.equal(third.requests[0].id,oldest.id);assert.equal(third.nextCursor,null);
  const found=await(await handler(get('/requests?q='+oldest.id))).json();assert.equal(found.requests.length,1);
  assert.equal((await handler(get('/requests?cursor=invalid'))).status,422);
  store.comment(actor,oldest.id,'Aviso','message');const now=Date.now()+5,job=store.getNotificationJobs(config.shop,now)[0];store.claimNotification(config.shop,job.id,now);store.finishNotification(config.shop,job.id,{status:'failed',now:now+1});
  const response=await handler(staff(`/requests/${oldest.id}/email-retry`,'9',{notificationId:job.id,operationId:'retry'}));assert.equal(response.status,200);assert.equal((await response.json()).notifications[0].status,'pending');
  assert.equal((await handler(staff(`/requests/${oldest.id}/email-retry`,'10',{notificationId:job.id,operationId:'bad'}))).status,401);
 }finally{store.close();}
});
test('HTTP authenticated staff proposes, customer accepts and no reservation/payment is fabricated', async () => {
  const store = createStore(':memory:'); const handler = createHandler({ store, config });
  try {
    const created = await (await handler(signed('/requests', '1', 'POST', { input: { requestText: 'Rosa', pickup: { label: '14 noviembre' } }, operationId: 'create-3' }))).json();
    const input = { proposal: { baseCents: 15000, surchargeCents: 2000, display: 'breakdown', canPrepare: 'Flores de fondant', changes: 'Sin flores naturales', reply: 'Propuesta' }, operationId: 'proposal-1' };
    assert.equal((await handler(staff(`/requests/${created.id}/proposals`, '10', input))).status, 401);
    const proposed = await handler(staff(`/requests/${created.id}/proposals`, '9', input));
    assert.equal(proposed.status, 200); const p = await proposed.json(); assert.equal(p.pendingProposal.totalCents, 17000);
    const accepted = await handler(signed(`/requests/${created.id}/accept`, '1', 'POST', { proposalVersion: p.pendingProposal.version, operationId: 'accept-1' }));
    assert.equal(accepted.status, 200); const a = await accepted.json(); assert.equal(a.acceptedProposal.totalCents, 17000); assert.equal(a.status, 'quoted'); assert.deepEqual(a.payments, []);
    assert.equal((await handler(staff(`/requests/${created.id}/status`, '9', { status: 'reserved', operationId: 'fake-paid' }))).status, 422);
  } finally { store.close(); }
});
test('private proxy rejects extra signed query fields that permit ambiguous canonical strings', async () => {
  const store = createStore(':memory:'); const handler = createHandler({ store, config });
  try {
    const s = store.createRequest({ shop: config.shop, customerId: '1' }, { requestText: 'Rosa', pickup: { label: '14 noviembre' } }, 'create-private');
    const url = new URL(signed(`/requests/${s.id}`).url); url.searchParams.delete('signature');
    url.searchParams.set('a', 'logged_in_customer_id=999m='); url.searchParams.set('m', '');
    const canonical = [...url.searchParams].map(([k,v]) => `${k}=${v}`).sort().join('');
    url.searchParams.set('signature', createHmac('sha256', config.secret).update(canonical).digest('hex'));
    assert.equal((await handler(new Request(url))).status, 401);
    url.searchParams.set('a', ''); url.searchParams.set('logged_in_customer_id', '999'); url.searchParams.set('m', 'logged_in_customer_id=1m=');
    assert.equal((await handler(new Request(url))).status, 401);
  } finally { store.close(); }
});

test('HTTP lists only owned requests and protects photo upload/read', async()=>{
 const store=createStore(':memory:');const handler=createHandler({store,config});
 try {
 const a=store.createRequest({shop:config.shop,customerId:'1'},{requestText:'Foto',pickup:{label:'Houston'}},'new-photo');
 assert.equal((await handler(signed('/requests'))).status,200);
 assert.equal((await (await handler(signed('/requests','2'))).json()).requests.length,0);
 const signedUrl=signed(`/requests/${a.id}/photos`).url;
 const upload=()=>new Request(signedUrl,{method:'POST',headers:{Origin:config.storefrontOrigin,'Content-Type':'image/jpeg','X-File-Name':'reference.jpg','X-Operation-Id':'photo-http'},body:new Uint8Array([255,216,255,224,1])});
 const response=await handler(upload());assert.equal(response.status,200);
 const snapshot=await response.json();const photoId=snapshot.attachments[0].id;
 const read=await handler(signed(`/requests/${a.id}/photos/${photoId}`));assert.equal(read.status,200);assert.equal(read.headers.get('content-type'),'image/jpeg');
 assert.equal((await handler(signed(`/requests/${a.id}/photos/${photoId}`,'2'))).status,404);
 assert.equal((await handler(upload())).status,200);
 }finally{store.close();}
});

test('session inspection verifies identity without granting staff access', async()=>{
 const store=createStore(':memory:');const handler=createHandler({store,config});try{
 const tokenRequest=staff('/session','10',{});
 const request=new Request(tokenRequest.url,{headers:tokenRequest.headers});
 const response=await handler(request);assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{staffId:'10',authorized:false});
 assert.equal((await handler(new Request('https://backend.test/admin/session'))).status,401);
 }finally{store.close();}
});
test('calendar writes are staff-only and signed clients can read closures',async()=>{
 const store=createStore(':memory:');const handler=createHandler({store,config});try{
 const write=await handler(staff('/calendar','9',{date:'2027-01-08',closed:true,operationId:'close-date'}));assert.equal(write.status,200);
 const result=await handler(signed('/calendar'));assert.equal(result.status,200);assert.equal((await result.json()).days[0].closed,true);
 assert.equal((await handler(signed('/calendar','1','POST',{date:'2027-01-08',closed:false,operationId:'reopen'}))).status,401);
 }finally{store.close();}
});
