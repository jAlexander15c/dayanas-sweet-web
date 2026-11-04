// Adapter for our internally generated plain-text MIME messages. Resend receives
// both the original text fallback and an escaped, branded HTML alternative.
// Never log the API key, provider response, recipient or capability URL.
const sender='info@dayanassweet.com';
const emailPattern=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;
export function renderEmailHtml({subject,text}) {
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Only the exact first-party tracking URL becomes an actionable button. No
 // customer-supplied markup, external assets, tracking pixels or URL rewriting.
 const adminLink=text.match(/^https:\/\/admin\.shopify\.com\/store\/[a-z0-9][a-z0-9-]*\/apps\/[a-zA-Z0-9_-]+\?solicitud=[a-f0-9-]{36}$/m)?.[0];
 const link=adminLink||text.match(/^https:\/\/dayanassweet\.com\/pages\/seguimiento-de-tu-pastel\?solicitud=[a-f0-9-]{36}(?:#acceso=[a-f0-9]{64})?$/m)?.[0];
 const reference=subject.match(/\bDS-\d{6,12}\b/)?.[0];
 const title=subject.replace(/(?:\s+—)?\s+DS-\d{6,12}$/,'');
 const button=link?`<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0"><tr><td bgcolor="#b72c60" style="border-radius:28px;text-align:center"><a href="${escape(link)}" style="display:inline-block;padding:16px 26px;border:1px solid #b72c60;border-radius:28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff;text-decoration:none">${adminLink?'Abrir en Shopify':'Ver mi cotización'}&nbsp; →</a></td></tr></table>`:'';
 const content=text.trim().split(/\n\n+/).filter(p=>p.trim()!=='Dayana’s Sweet').map(paragraph=>{
  const hasLink=link&&paragraph.split('\n').includes(link);
  const clean=hasLink?paragraph.replace(link,'').trim().replace(/:$/ ,'.'):paragraph;
  const privacy=/^(Conserva este enlace|Este enlace es privado|Ingresa con la cuenta)/.test(clean);
  return `<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:${privacy?'13':'16'}px;line-height:1.65;color:${privacy?'#75666d':'#49343e'};overflow-wrap:anywhere">${escape(clean).replace(/\n/g,'<br>')}</p>${hasLink?button:''}`;
 }).join('');
 return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#fff7fa;color:#49343e">
<div style="display:none;font-size:1px;color:#fff7fa;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escape(subject)}. Consulta los detalles de tu pastel.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fff7fa"><tr><td align="center" style="padding:28px 12px">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px">
<tr><td align="center" style="padding:8px 12px 28px;font-family:Georgia,'Times New Roman',serif;font-size:29px;line-height:1.3;color:#49343e">Dayana’s <em style="color:#b72c60">Sweet</em></td></tr>
<tr><td bgcolor="#ffffff" style="padding:30px 24px;border:1px solid #ecdce4;border-top:4px solid #b72c60;border-radius:16px">
<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;font-weight:bold;color:#a73a61">UN PASTEL PARA TU CELEBRACIÓN</p>
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;font-weight:bold;color:#49343e">${escape(title)}</h1>
${reference?`<p style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#75666d">Tu solicitud <strong style="color:#b72c60;letter-spacing:1px">${escape(reference)}</strong></p>`:''}
${content}</td></tr>
<tr><td align="center" style="padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#897781">Hecho a mano, para tu celebración.<br>Dayana’s Sweet</td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
export function createResendTransport({apiKey,fetchImpl=fetch,timeoutMs=12000}) {
 if(typeof apiKey!=='string'||!/^re_[A-Za-z0-9_-]+$/.test(apiKey)||typeof fetchImpl!=='function')throw new Error('UNAVAILABLE');
 return async({recipient,message,onDiagnostic})=>{
  if(typeof recipient!=='string'||recipient.length>254||!emailPattern.test(recipient)||typeof message!=='string'||message.length>16384)return {status:'failed'};
  const parts=message.split('\r\n\r\n');
  if(parts.length!==2)return {status:'failed'};
  const lines=parts[0].split('\r\n');
  const header=name=>{const values=lines.filter(line=>line.startsWith(name+': '));return values.length===1?values[0].slice(name.length+2):null;};
  const subject=header('Subject'),messageId=header('Message-ID');
  if(header('From')!==`Dayana's Sweet <${sender}>`||header('To')!==`<${recipient}>`||
   header('Content-Transfer-Encoding')!=='base64'||header('Content-Type')!=='text/plain; charset=UTF-8'||
   !subject||subject.length>200||!/^<(?:(?:quote|notice)-[a-f0-9-]{36}|smtp-test-[a-zA-Z0-9_-]{1,80})@dayanassweet\.com>$/.test(messageId||'')||
   !/^[A-Za-z0-9+/=\r\n]+$/.test(parts[1]))return {status:'failed'};
  const payload={from:`Dayana's Sweet <${sender}>`,to:[recipient],reply_to:sender,subject,
   text:Buffer.from(parts[1].replace(/\r\n/g,''),'base64').toString('utf8')};
  payload.html=renderEmailHtml(payload);
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('TIMEOUT'));},timeoutMs);});
  try {
   const outcome=async()=>{
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:controller.signal,
     headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':messageId.slice(1,-1)},body:JSON.stringify(payload)});
    if(!response.ok){
     try{onDiagnostic?.({phase:'resend',responseCode:response.status});}catch{}
     // Never replay an uncertain result after the provider's 24-hour deduplication window.
     return {status:response.status===429?'pending':[400,401,403,404,413,422].includes(response.status)?'failed':'unknown'};
    }
    const data=await response.json();
    return {status:typeof data?.id==='string'&&data.id.length>0?'sent':'unknown'};
   };
   return await Promise.race([outcome(),deadline]);
  }catch {
   try{onDiagnostic?.({phase:'resend',failure:controller.signal.aborted?'timeout':'transport'});}catch{}
   return {status:'unknown'};
  }finally{clearTimeout(timer);}
 };
}
