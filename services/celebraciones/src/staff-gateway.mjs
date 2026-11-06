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

// Orders panel actor: set only by Inventario after its own session check.
// stepUp is true only after Inventario verified the admin password for this request.
// stockVerified is true only after Inventario checked the stock of this edit, which it does
// only when Celebraciones answered STOCK_CHECK_REQUIRED (a write is about to be sent).
export function portalOrdersActor(actor,shop) {
  if(!actor||actor.shop!==shop||actor.aud!=='pedidos'||typeof actor.userId!=='string'
    ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(actor.userId)||typeof actor.name!=='string'||!actor.name.trim()||actor.name.length>120
    ||!Array.isArray(actor.roles)||!actor.roles.some(role=>role==='inventario'||role==='admin')
    ||!actor.roles.every(role=>['admin','inventario','celebraciones'].includes(role))
    ||(actor.stepUp!==undefined&&actor.stepUp!==true)||(actor.stockVerified!==undefined&&actor.stockVerified!==true)||Object.hasOwn(actor,'password')
    ||!Number.isSafeInteger(actor.sessionVersion)||actor.sessionVersion<1)throw denied();
  return {shop,staffId:`user:${actor.userId}`,staffName:actor.name.trim(),roles:[...actor.roles],stepUp:actor.stepUp===true,stockVerified:actor.stockVerified===true};
}
export const isOrdersPath=path=>typeof path==='string'&&/^\/orders(?:[/?#]|$)/.test(path);
/** Audience is chosen by path: an orders actor never reaches Celebraciones routes and vice versa. */
export function trustedPortalActor(input,shop) {
  return isOrdersPath(input?.path)?portalOrdersActor(input?.actor,shop):portalStaffActor(input?.actor,shop);
}

const ORDER_WRITES=new Set(['note','fulfill','ready','delivered','refund-preview','cash','refund','edit','cancel']);
const ADMIN_ONLY=new Set(['refund-preview','cash','refund','edit','cancel']);
const STEP_UP=new Set(['cash','refund','edit','cancel']);
export async function handleOrdersGateway(input,options) {
  let actor;
  try {actor=portalOrdersActor(input?.actor,options.config.shop);} catch {return {status:401,body:{code:'AUTH_REQUIRED'}};}
  const service=options.ordersService;
  if(!service)return {status:503,body:{code:'UNAVAILABLE'}};
  const path=input.path;
  if(path.length>200||/[\\\r\n?#]/.test(path))return {status:404,body:{code:'NOT_FOUND'}};
  if(input.method==='GET'){
    if(path==='/orders')return service.list(actor);
    const match=/^\/orders\/(\d{1,20})$/.exec(path);
    return match?service.detail(match[1],actor):{status:404,body:{code:'NOT_FOUND'}};
  }
  const match=input.method==='POST'&&/^\/orders\/(\d{1,20})\/([a-z-]+)$/.exec(path);
  if(!match||!ORDER_WRITES.has(match[2]))return {status:404,body:{code:'NOT_FOUND'}};
  const [,id,action]=match;
  const body=input.body;
  let size=0;
  try {size=new TextEncoder().encode(JSON.stringify(body)).length;} catch {size=Infinity;}
  if(!body||typeof body!=='object'||Array.isArray(body)||size>32768||Object.hasOwn(body,'password'))return {status:422,body:{code:'VALIDATION'}};
  if(ADMIN_ONLY.has(action)&&!actor.roles.includes('admin'))return {status:403,body:{code:'ROLE_REQUIRED',message:'Solo la administradora puede hacer esto.'}};
  if(STEP_UP.has(action)&&actor.stepUp!==true)return {status:403,body:{code:'STEP_UP_REQUIRED',message:'Esta acción necesita la contraseña de la administradora.'}};
  if(action==='note')return service.note(id,body,actor);
  if(action==='refund-preview')return service.refundPreview(id,body,actor);
  return service.execute(action,id,body,actor);
}

// Only called by the named RPC entrypoint. Never populated from HTTP headers.
export async function handleStaffGateway(input,options) {
  if(isOrdersPath(input?.path)){
    if(!['GET','POST'].includes(input.method))return {status:404,body:{code:'NOT_FOUND'}};
    try {return await handleOrdersGateway(input,options);} catch {return {status:503,body:{code:'UNAVAILABLE'}};}
  }
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
