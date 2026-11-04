import { createHmac } from 'node:crypto';
// No server reply, credentials, recipient or private link is ever logged.
const sender = 'info@dayanassweet.com';
const encoder = new TextEncoder();
const capabilityPattern = /^[a-f0-9]{64}$/;
const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;
const failure = () => Object.assign(new Error('UNAVAILABLE'), {code:'UNAVAILABLE'});
const b64 = bytes => Buffer.from(bytes).toString('base64');

export function buildNotificationMessage(job,capability,storefrontOrigin){
  const subjects={propose:'Nueva propuesta para tu pastel',comment:'Nuevo mensaje de la pastelera',preparing:'Tu pastel está en preparación',ready:'Tu pastel está listo'};
  const kind=job.event?.kind==='setStatus'?job.event.status:job.event?.kind;
  if(!subjects[kind]||!/^[a-f0-9-]{36}$/.test(job.id)||!/^[a-f0-9-]{36}$/.test(job.requestId)
    ||typeof job.contact?.email!=='string'||job.contact.email.length>254||!emailPattern.test(job.contact.email)
    ||(job.isGuest&&!capabilityPattern.test(capability)))throw failure();
  const origin=new URL(storefrontOrigin);if(origin.protocol!=='https:'||origin.origin!==storefrontOrigin)throw failure();
  const suffix=job.reference&&/^DS-\d{6,12}$/.test(job.reference)?` — ${job.reference}`:'';
  const subject=subjects[kind]+suffix;
  const link=`${origin.origin}/pages/seguimiento-de-tu-pastel?solicitud=${job.requestId}${job.isGuest?`#acceso=${capability}`:''}`;
  const content=`Hola,\n\n${subject}.\n\nConsulta los detalles y responde desde el seguimiento de tu pastel:\n${link}\n\n${job.isGuest?'Este enlace es privado. Consérvalo y no lo compartas.':'Ingresa con la cuenta con la que hiciste tu solicitud.'}${kind==='propose'?'\nLa propuesta no confirma una reserva: revisa las condiciones y el pago correspondiente en el seguimiento.':''}\n\nDayana’s Sweet\n`;
  return [`From: Dayana's Sweet <${sender}>`,`To: <${job.contact.email}>`,`Reply-To: <${sender}>`,
    `Subject: ${subject}`,`Message-ID: <notice-${job.id}@dayanassweet.com>`,
    'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
    b64(encoder.encode(content)).match(/.{1,76}/g).join('\r\n')].join('\r\n');
}

export function buildQuoteMessage(job, capability, storefrontOrigin) {
  if (!capabilityPattern.test(capability) || !/^[a-f0-9-]{36}$/.test(job.id) || !/^DS-\d{6,12}$/.test(job.reference)
      || typeof job.contact?.email !== 'string' || job.contact.email.length>254 || !emailPattern.test(job.contact.email)
      || typeof job.contact.name !== 'string' || job.contact.name.length>120) throw failure();
  const origin = new URL(storefrontOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== storefrontOrigin) throw failure();
  const link = `${origin.origin}/pages/seguimiento-de-tu-pastel?solicitud=${job.id}#acceso=${capability}`;
  const content = `Hola ${job.contact.name},\n\nRecibimos tu solicitud ${job.reference}.\n\nPuedes consultar la cotización y conversar con Dayana desde tu enlace privado:\n${link}\n\nConserva este enlace y no lo compartas. Tu solicitud todavía no reserva la fecha; la reserva se confirma con el pago correspondiente y la disponibilidad.\n\nDayana’s Sweet\n`;
  return [`From: Dayana's Sweet <${sender}>`, `To: <${job.contact.email}>`, `Reply-To: <${sender}>`,
    `Subject: Recibimos tu solicitud ${job.reference}`, `Message-ID: <quote-${job.id}@dayanassweet.com>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
    '', b64(encoder.encode(content)).match(/.{1,76}/g).join('\r\n')].join('\r\n');
}

/** SMTP over implicit TLS. connect is Cloudflare's cloudflare:sockets connect.
 * Only a final 250 proves server acceptance. A lost DATA response is unknown.
 */
export async function sendSmtp({connect, password, recipient, message, timeoutMs=12000, onDiagnostic}) {
  if (typeof password!=='string'||!password||typeof connect!=='function'||!emailPattern.test(recipient)||recipient.length>254||typeof message!=='string'||message.length>16384) return {status:'failed'};
  let socket, reader, writer, timer, transmitting=false, accepted=false, explicitFailure=null, stopped=false, phase='connect', responseCode=null;
  const timeout = new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;try{socket?.close();}catch{}reject(failure());},timeoutMs);});
  async function exchange() {
    socket = connect({hostname:'smtp.hostinger.com',port:465},{secureTransport:'on'});
    socket.closed?.catch(()=>{});
    await socket.opened;
    reader=socket.readable.getReader();writer=socket.writable.getWriter();
    let buffer='',total=0;
    async function line() {
      while(!buffer.includes('\r\n')) {
        if(stopped)throw failure();
        const chunk=await reader.read();if(chunk.done)throw failure();
        total+=chunk.value.length;if(total>32768)throw failure();
        buffer+=new TextDecoder().decode(chunk.value);
        if(buffer.length>8192)throw failure();
      }
      const end=buffer.indexOf('\r\n'), value=buffer.slice(0,end);buffer=buffer.slice(end+2);return value;
    }
    async function response(expected) {
      let code=null,lines=[];
      for(let n=0;n<100;n++) {
        const value=await line(),match=/^(\d{3})([- ])(.*)$/.exec(value);
        if(!match || (code!==null && code!==Number(match[1])))throw failure();
        code=Number(match[1]);responseCode=code;lines.push(match[3]);
        if(match[2]===' ') {
          if(code!==expected) {explicitFailure=code>=400&&code<500?'pending':code>=500&&code<600?'failed':null;throw failure();}
          return lines.join('\n');
        }
      }
      throw failure();
    }
    async function write(value) {if(stopped)throw failure();await writer.write(encoder.encode(value));}
    async function command(value, expected) {await write(value+'\r\n');return response(expected);}
    phase='greeting';await response(220);
    phase='hello';
    const hello=await command('EHLO dayanassweet.com',250);
    if(!/^AUTH\s+.*\bLOGIN\b/im.test(hello))throw failure();
    phase='auth';await command('AUTH LOGIN',334);
    await command(b64(encoder.encode(sender)),334);
    await command(b64(encoder.encode(password)),235);
    phase='sender';await command(`MAIL FROM:<${sender}>`,250);
    phase='recipient';await command(`RCPT TO:<${recipient}>`,250);
    phase='data';await command('DATA',354);
    transmitting=true;
    await write(message.replace(/(^|\r\n)\./g,'$1..')+'\r\n.\r\n');
    await response(250);accepted=true;
    return {status:'sent'};
  }
  try {return await Promise.race([exchange(),timeout]);}
  catch (error) {
    try{onDiagnostic?.({phase,responseCode,...(phase==='connect'?{connectionError:String(error?.message||'Connection failed').slice(0,240)}:{}),failure:stopped?'timeout':explicitFailure?'smtp-rejected':'transport',code:['ERR_TLS_CERT_ALTNAME_INVALID','ECONNRESET','ETIMEDOUT','ECONNREFUSED','ERR_SSL_WRONG_VERSION_NUMBER'].includes(error?.code)?error.code:null});}catch{}
    return {status:accepted?'sent':explicitFailure||(transmitting?'unknown':'pending')};
  }
  finally {
    stopped=true;clearTimeout(timer);
    try {await socket?.close();} catch { /* Closing cannot undo an accepted message. */ }
    try {reader?.releaseLock();writer?.releaseLock();} catch {}
  }
}

export function createQuoteEmail({key,password,storefrontOrigin,connect,send}) {
  if(typeof key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(key)||Buffer.from(key,'base64').length!==32||(typeof send!=='function'&&(typeof password!=='string'||!password)))throw failure();
  const transport=typeof send==='function'?send:value=>sendSmtp({...value,connect,password});
  const cryptoKey=crypto.subtle.importKey('raw',Buffer.from(key,'base64'),'AES-GCM',false,['encrypt','decrypt']);
  const additionalData=encoder.encode('dayanas-guest-email-v1');
  async function seal(capability) {
    if(!capabilityPattern.test(capability))throw failure();
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},await cryptoKey,encoder.encode(capability));
    return 'v1.'+b64(iv)+'.'+b64(new Uint8Array(cipher));
  }
  async function unseal(value) {
    try {
      const parts=value.split('.');if(parts.length!==3||parts[0]!=='v1'||value.length>256)throw failure();
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(parts[1],'base64'),additionalData},await cryptoKey,Buffer.from(parts[2],'base64'));
      const result=new TextDecoder().decode(plain);if(!capabilityPattern.test(result))throw failure();return result;
    }catch{throw failure();}
  }
  return {seal,unseal,
  notificationCapability(shop,id,requestId){
    // Domain-separated, stable per event and unguessable; only its hash is saved.
    return createHmac('sha256',Buffer.from(key,'base64')).update(JSON.stringify(['dayanas-notification-v1',shop,id,requestId])).digest('hex');
  },
  async deliverNotification(job,capability){
    try{return await transport({recipient:job.contact.email,message:buildNotificationMessage(job,capability,storefrontOrigin)});}
    catch{return {status:'unknown'};}
  },async deliver(job) {
    try {const capability=await unseal(job.encryptedAccess);return await transport({recipient:job.contact.email,message:buildQuoteMessage(job,capability,storefrontOrigin)});}
    catch {return {status:'failed'};}
  }};
}

export async function runQuoteEmailJobs({store,shop,email,now=Date.now}) {
  for(const due of store.getGuestEmailJobs(shop,now(),2)) {
    const job=store.claimGuestEmail(shop,due.id,now());if(!job)continue;
    let result;
    try {result=await email.deliver(job);} catch {result={status:'unknown'};}
    let status=['sent','pending','failed','unknown'].includes(result?.status)?result.status:'unknown';
    if(status==='pending'&&job.attempts>=3)status='failed';
    store.finishGuestEmail(shop,job.id,{status,now:now(),nextAttemptAt:status==='pending'?now()+60000*2**job.attempts:null});
  }
}
