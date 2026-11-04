import { verifyAppProxy, verifyAdminSession } from './shopify-auth.mjs';
import { randomUUID } from 'node:crypto';
import { hashCapability, validateGuestContact, decodeGuestPhoto } from './guest-access.mjs';
const status = { AUTH_REQUIRED: 401, NOT_FOUND: 404, CONFLICT: 409, QUOTE_EXPIRED:409, CHECKOUT_PENDING:409, VALIDATION: 422, UNAVAILABLE: 503, RATE_LIMITED: 429 };
const error = code => Object.assign(new Error(code), { code });
function json(body, code = 200) { return Response.json(body, { status: code, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
async function readBody(request, limit = 32768) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw error('VALIDATION');
  if (Number(request.headers.get('content-length')) > limit) throw Object.assign(error('VALIDATION'), { httpStatus: 413 });
  const reader = request.body?.getReader(); if (!reader) throw error('VALIDATION');
  const chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw Object.assign(error('VALIDATION'), { httpStatus: 413 }); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw error('VALIDATION'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw error('VALIDATION');
  return body;
}
async function readPhoto(request) {
  const limit = 2 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > limit) throw Object.assign(error('VALIDATION'),{httpStatus:413});
  const mimeType=request.headers.get('content-type');
  if(!['image/jpeg','image/png','image/webp'].includes(mimeType)) throw error('VALIDATION');
  const reader=request.body?.getReader();if(!reader) throw error('VALIDATION');
  const chunks=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Object.assign(error('VALIDATION'),{httpStatus:413});}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let name;try{name=decodeURIComponent(request.headers.get('x-file-name')||'');}catch{throw error('VALIDATION');}
  return {bytes,name,mimeType};
}
function shape(body, keys) { if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !(key in body))) throw error('VALIDATION'); }
export function createHandler({ store, config, paymentService, guestEmail, mailTest }) {
  return async request => {
    try {
      const guestUrl=new URL(request.url);
      if(guestUrl.pathname.startsWith('/proxy/guest/')){
        const match=guestUrl.pathname.match(/^\/proxy\/guest\/(calendar|requests)(?:\/([a-zA-Z0-9-]{1,100})\/(tracking|comments|accept|payment|payment-sync|photos)(?:\/([a-zA-Z0-9-]{1,100}))?)?$/);
        if(!match||request.method!=='POST')throw error('NOT_FOUND');
        const [,resource,id,action,photoId]=match;
        if(resource==='calendar'&&id||photoId&&action!=='photos')throw error('NOT_FOUND');
        const signedFields=new Set(['signature','shop','logged_in_customer_id','path_prefix','timestamp']);
        if([...guestUrl.searchParams.keys()].some(key=>!signedFields.has(key)))throw error('AUTH_REQUIRED');
        await verifyAppProxy(guestUrl.href,{secret:config.secret,shop:config.shop,allowAnonymous:true});
        if(request.headers.get('origin')!==config.storefrontOrigin)return json({code:'AUTH_REQUIRED'},403);
        if(!id&&config.guestEnabled!==true)throw error('UNAVAILABLE');
        const body=await readBody(request,action==='photos'&&!photoId?2797300:32768);
        if(resource==='calendar'){shape(body,[]);return json(store.getCalendar({shop:config.shop,customerId:'guest-calendar'}));}
        if(!id){
          shape(body,['input','contact','capability','operationId','website']);
          if(body.website!=='')throw error('VALIDATION');
          hashCapability(body.capability);validateGuestContact(body.contact);
          if(config.requireDetails&&!body.input?.details)throw error('VALIDATION');
          if(typeof guestEmail?.seal!=='function'||typeof guestEmail?.wake!=='function')throw error('UNAVAILABLE');
          const encryptedAccess=await guestEmail.seal(body.capability);
          const snapshot=store.createGuestRequest({shop:config.shop},body.input,body.contact,body.capability,body.operationId,{encryptedAccess,now:Date.now()});
          // The durable outbox remains authoritative if scheduling fails after save.
          try{await guestEmail.wake();}catch{/* The next alarm can recover the queued email. */}
          return json(snapshot);
        }
        const actor=store.authenticateGuest(config.shop,id,body.capability);
        if(action==='tracking'){shape(body,['capability']);return json(store.getTracking(actor,id));}
        if(action==='comments'){shape(body,['capability','text','operationId']);return json(store.comment(actor,id,body.text,body.operationId));}
        if(action==='accept'){shape(body,['capability','proposalVersion','operationId']);return json(store.accept(actor,id,body.proposalVersion,body.operationId));}
        if(['payment','payment-sync'].includes(action)){shape(body,['capability','operationId']);if(!paymentService)throw error('UNAVAILABLE');return json(await paymentService[action==='payment'?'pay':'sync'](actor,id,body.operationId));}
        if(action==='photos'){
          if(photoId){shape(body,['capability']);const photo=store.getPhoto(actor,id,photoId);return new Response(photo.bytes,{headers:{'Content-Type':photo.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});}
          shape(body,['capability','name','mimeType','base64','operationId']);return json(store.addPhoto(actor,id,decodeGuestPhoto(body),body.operationId));
        }
        throw error('NOT_FOUND');
      }
      if(new URL(request.url).pathname==='/admin/session' && request.method==='GET') {
        const header=request.headers.get('authorization')||'';
        if(!header.startsWith('Bearer ')) throw error('AUTH_REQUIRED');
        const identity=await verifyAdminSession(header.slice(7),{secret:config.secret,shop:config.shop,clientId:config.clientId});
        return json({staffId:identity.staffId,authorized:config.staffIds?.includes(identity.staffId)===true});
      }
      const url = new URL(request.url), calendarMatch=url.pathname.match(/^\/(proxy|admin)\/calendar$/), paymentStatusMatch=url.pathname.match(/^\/(admin)\/payment-status$/);
      const mailTestMatch=url.pathname.match(/^\/(admin)\/email-test$/);
      const match = calendarMatch || paymentStatusMatch || mailTestMatch || url.pathname.match(/^\/(proxy|admin)\/requests(?:\/([a-zA-Z0-9-]{1,100}))?(?:\/(comments|accept|proposals|status|photos|payment|payment-sync|email-retry)(?:\/([a-zA-Z0-9-]{1,100}))?)?$/);
      if (!match) return json({ code: 'NOT_FOUND' }, 404);
      const [, surface, id, action, photoId] = match;
      if(photoId && action!=='photos') throw error('NOT_FOUND');
      let actor;
      if (surface === 'proxy') {
        // This private API has no custom query fields. Keep its accepted signed
        // vocabulary closed; arbitrary fields make Shopify's separator-free
        // canonical representation ambiguous. Reassess if Shopify adds fields.
        const signedFields = new Set(['signature', 'shop', 'logged_in_customer_id', 'path_prefix', 'timestamp']);
        if ([...url.searchParams.keys()].some(key => !signedFields.has(key))) throw error('AUTH_REQUIRED');
        actor = await verifyAppProxy(url.href, { secret: config.secret, shop: config.shop });
        if (config.testCustomerIds !== undefined && !config.testCustomerIds.includes(actor.customerId)) throw error('UNAVAILABLE');
        if (request.method !== 'GET' && request.headers.get('origin') !== config.storefrontOrigin) return json({ code: 'AUTH_REQUIRED' }, 403);
      } else {
        const header = request.headers.get('authorization') || '';
        if (!header.startsWith('Bearer ')) throw error('AUTH_REQUIRED');
        const identity = await verifyAdminSession(header.slice(7), { secret: config.secret, shop: config.shop, clientId: config.clientId });
        if (!config.staffIds?.includes(identity.staffId)) throw error('AUTH_REQUIRED');
        actor = { ...identity, role: 'staff' };
      }
      if(paymentStatusMatch){if(request.method!=='GET')throw error('NOT_FOUND');if(!paymentService)throw error('UNAVAILABLE');return json(await paymentService.checkConfiguration());}
      if(mailTestMatch){if(request.method!=='POST')throw error('NOT_FOUND');const body=await readBody(request);shape(body,['operationId']);if(!mailTest)throw error('UNAVAILABLE');return json(await mailTest(body.operationId));}
      if(calendarMatch){
        if(request.method==='GET')return json(store.getCalendar(actor));
        if(request.method==='POST'){
          if(surface!=='admin')throw error('AUTH_REQUIRED');
          const body=await readBody(request);shape(body,['date','closed','operationId']);
          return json(store.setCalendar(actor,body.date,body.closed,body.operationId));
        }
        throw error('NOT_FOUND');
      }
      if(request.method==='GET' && !id && !action) {
        if(surface==='admin')return json(store.listRequestPage(actor,{cursor:url.searchParams.get('cursor'),query:url.searchParams.get('q')||''}));
        return json({requests:store.listRequests(actor)});
      }
      if(request.method==='GET' && id && action==='photos' && photoId){
        const photo=store.getPhoto(actor,id,photoId);
        return new Response(photo.bytes,{headers:{'Content-Type':photo.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});
      }
      if (request.method === 'GET' && id && !action) return json(store.getTracking(actor, id));
      if(request.method==='GET'&&id&&['payment','payment-sync'].includes(action))return json(store.getTracking(actor,id));
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      if(action==='photos' && id && !photoId && surface==='proxy') {
        store.getTracking(actor,id);
        const photo=await readPhoto(request);
        return json(store.addPhoto(actor,id,photo,request.headers.get('x-operation-id')));
      }
      const body = await readBody(request);
      if (!id && !action && surface === 'proxy') { shape(body, ['input', 'operationId']); if(config.requireDetails && !body.input?.details) throw error('VALIDATION'); return json(store.createRequest(actor, body.input, body.operationId)); }
      if (!id) throw error('NOT_FOUND');
      if(['payment','payment-sync'].includes(action)){
        store.getTracking(actor,id);
        if(surface==='admin'&&action!=='payment-sync')throw error('AUTH_REQUIRED');
        shape(body,['operationId']);
        if(!paymentService)throw error('UNAVAILABLE');
        return json(await paymentService[action==='payment'?'pay':'sync'](actor,id,body.operationId));
      }
      if (action === 'comments') { shape(body, ['text', 'operationId']); return json(store.comment(actor, id, body.text, body.operationId)); }
      if (action === 'accept' && surface === 'proxy') { shape(body, ['proposalVersion', 'operationId']); return json(store.accept(actor, id, body.proposalVersion, body.operationId)); }
      if(action==='email-retry'&&surface==='admin'){shape(body,['notificationId','operationId']);return json(store.retryNotification(actor,id,body.notificationId,body.operationId));}
      if (action === 'proposals' && surface === 'admin') {
        shape(body, ['proposal', 'operationId']);
        const context=store.getPaymentContext(actor,id);
        if(context.state?.draftId&&!context.state.orderId){
          if(!paymentService)throw error('CHECKOUT_PENDING');
          await paymentService.sync(actor,id,`proposal-${randomUUID()}`);
        }
        return json(store.propose(actor, id, body.proposal, body.operationId));
      }
      if (action === 'status' && surface === 'admin') {
        shape(body, ['status', 'operationId']);
        if(['ready','preparing'].includes(body.status)) {
          if(!paymentService)throw error('UNAVAILABLE');
          // A fresh operation on every HTTP attempt checks refunds/cancellations
          // even when a previous ready attempt or reconciliation was retried.
          const current=await paymentService.sync(actor,id,`ready-${randomUUID()}`);
          if(current.payment?.reviewRequired||current.pendingProposal)throw error('CONFLICT');
          if(body.status==='ready'&&current.payment?.stage!=='paid')throw error('CONFLICT');
          if(body.status==='preparing'&&!['paid','balance'].includes(current.payment?.stage))throw error('CONFLICT');
        }
        return json(store.setStatus(actor, id, body.status, body.operationId));
      }
      throw error('NOT_FOUND');
    } catch (e) {
      const code = Object.hasOwn(status, e?.code) ? e.code : 'UNAVAILABLE';
      return json({ code }, e?.httpStatus === 413 ? 413 : status[code]);
    }
  };
}
