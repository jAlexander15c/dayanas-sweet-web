// Adapter for our internally generated plain-text MIME messages only.
// Never log the API key, provider response, recipient or capability URL.
const sender='info@dayanassweet.com';
const emailPattern=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;
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
