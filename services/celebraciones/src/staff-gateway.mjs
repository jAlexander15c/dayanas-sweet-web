import { createHandler } from './http.mjs';

const denied=()=>Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
export function portalStaffActor(actor,shop) {
  if(!actor||actor.shop!==shop||actor.aud!=='celebraciones'||typeof actor.userId!=='string'
    ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(actor.userId)||typeof actor.name!=='string'||actor.name.length>120
    ||!Array.isArray(actor.roles)||!actor.roles.includes('celebraciones')
    ||!actor.roles.every(role=>['admin','inventario','celebraciones'].includes(role))
    ||!Number.isSafeInteger(actor.sessionVersion)||actor.sessionVersion<1)throw denied();
  return {shop,role:'staff',staffId:`user:${actor.userId}`};
}

// Only called by the named RPC entrypoint. Never populated from HTTP headers.
export async function handleStaffGateway(input,options) {
  try {
    const trustedStaff=portalStaffActor(input?.actor,options.config.shop);
    if(!['GET','POST'].includes(input.method)||typeof input.path!=='string'||input.path.length>1000
      ||!/^\/(?:session|calendar|staff-alerts|payment-status|requests(?:\/[a-zA-Z0-9-]+(?:\/(?:comments|proposals|status|photos|payment-sync|email-retry|delivery-payment)(?:\/[a-zA-Z0-9-]+)?)?)?)(?:\?[^#]*)?$/.test(input.path)
      ||/[\\\r\n]/.test(input.path))return {status:404,body:{code:'NOT_FOUND'}};
    const url=new URL(`https://staff-gateway.internal/admin${input.path}`);
    if([...url.searchParams.keys()].some(key=>!['q','cursor'].includes(key))
      ||(url.search&&url.pathname!=='/admin/requests'))return {status:422,body:{code:'VALIDATION'}};
    const serialized=input.method==='POST'?JSON.stringify(input.body):undefined;
    if(input.method==='POST'&&(!serialized||new TextEncoder().encode(serialized).length>32768))return {status:422,body:{code:'VALIDATION'}};
    const response=await createHandler({...options,trustedStaff})(new Request(url,{method:input.method,
      ...(serialized?{headers:{'Content-Type':'application/json'},body:serialized}:{})}));
    const mimeType=response.headers.get('Content-Type')?.split(';')[0];
    if(response.ok&&['image/jpeg','image/png','image/webp'].includes(mimeType)) {
      return {status:response.status,body:{mimeType,base64:Buffer.from(await response.arrayBuffer()).toString('base64')}};
    }
    return {status:response.status,body:await response.json()};
  } catch(error) {return {status:error?.code==='AUTH_REQUIRED'?401:503,body:{code:error?.code==='AUTH_REQUIRED'?'AUTH_REQUIRED':'UNAVAILABLE'}};}
}
