import { createHash } from 'node:crypto';
const invalid=()=>{throw Object.assign(new Error('VALIDATION'),{code:'VALIDATION'});};
export function hashCapability(value) {
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))invalid();
  return createHash('sha256').update(Buffer.from(value,'hex')).digest('hex');
}
export function validateGuestContact(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||!['name','email','phone'].every(key=>Object.hasOwn(value,key)))invalid();
  const result={};
  for(const [key,limit] of [['name',120],['email',254],['phone',40]]){
    if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>limit||/[\x00-\x1f\x7f]/.test(value[key]))invalid();
    result[key]=value[key].trim();
  }
  if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(result.email)||!/^\+?[\d ().-]+$/.test(result.phone)||result.phone.replace(/\D/g,'').length<7)invalid();
  return result;
}
export function guestRecipientKey(email) {
  return createHash('sha256').update(`guest-recipient-v1:${email.trim().toLowerCase()}`).digest('hex');
}
export function decodeGuestPhoto(body) {
  const value=body.base64;
  if(typeof value!=='string'||value.length>2796204||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))invalid();
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>2097152)throw Object.assign(new Error('VALIDATION'),{code:'VALIDATION',httpStatus:413});
  if(bytes.toString('base64')!==value)invalid();
  return {bytes:new Uint8Array(bytes),name:body.name,mimeType:body.mimeType};
}
