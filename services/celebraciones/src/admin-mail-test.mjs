// Authenticated staff-only commissioning test. Fixed recipient; no customer data.
export function createAdminMailTest({storage,lock,send,now=Date.now,transport='smtp'}) {
  if(!['smtp','resend'].includes(transport))throw new Error('UNAVAILABLE');
  return async operationId=>{
    if(typeof operationId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(operationId))throw Object.assign(new Error('VALIDATION'),{code:'VALIDATION'});
    const key=transport==='smtp'?'admin-mail-test-v1':'admin-mail-test-v1-resend';
    const claim=await lock(async()=>{
      const prior=await storage.get(key);
      const resendRetry=transport==='resend'&&prior?.status==='unknown'&&now()-(prior.firstAttemptAt??prior.at)<23*3600000;
      if(prior?.operationId===operationId && !((prior.status==='pending'||resendRetry)&&(prior.attempts||1)<3&&now()-prior.at>=60000))return {status:prior.status,...(prior.diagnostic?{diagnostic:prior.diagnostic}:{})};
      if(prior?.operationId!==operationId&&prior&&now()-prior.at<3600000)return {conflict:true};
      await storage.put(key,{operationId,at:now(),firstAttemptAt:prior?.operationId===operationId?(prior.firstAttemptAt??prior.at):now(),status:'unknown',attempts:prior?.operationId===operationId?(prior.attempts||1)+1:1});
      return null;
    });
    if(claim?.conflict)throw Object.assign(new Error('CONFLICT'),{code:'CONFLICT'});
    if(claim)return claim;
    const message=["From: Dayana's Sweet <info@dayanassweet.com>",'To: <info@dayanassweet.com>',
      'Subject: Prueba de correo de cotizaciones',`Message-ID: <smtp-test-${operationId}@dayanassweet.com>`,
      'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
      Buffer.from('Esta es la prueba autorizada de conexion del correo de cotizaciones de Dayana\u2019s Sweet. No corresponde a una solicitud de cliente ni confirma una reserva. La cotizacion sin cuenta sigue desactivada mientras terminamos las pruebas.','utf8').toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n');
    let status='unknown',diagnostic;
    try{const result=await send({recipient:'info@dayanassweet.com',message,onDiagnostic:value=>{diagnostic=value;}});if(['sent','pending','failed','unknown'].includes(result?.status))status=result.status;}catch{/* Never echo SMTP errors or retry a possibly accepted message. */}
    const claimed=await storage.get(key);
    await storage.put(key,{operationId,at:now(),firstAttemptAt:claimed?.firstAttemptAt??claimed?.at??now(),status,attempts:claimed?.attempts||1,...(diagnostic?{diagnostic}:{})});
    return {status,...(diagnostic?{diagnostic}:{})};
  };
}
