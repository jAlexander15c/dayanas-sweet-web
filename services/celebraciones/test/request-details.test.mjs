import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
const customer = { shop: 'bakery.myshopify.com', customerId: '1' };
const other = { ...customer, customerId: '2' };
const staff = { shop: customer.shop, staffId: '3', role: 'staff' };
const future=new Date(Date.now()+9*86400000);future.setUTCHours(18,0,0,0);
const input = { requestText: 'Flores', pickup: { label: 'Houston' }, details: { pickupAt: future.toISOString(), urgent: false, tiers: [{diameter: 8, sponges:['Vainilla','Chocolate'], fillings:['Guayaba','Nutella']}], coating:'Merengue', decorations:['Flores de fondant'] } };
test('structured requests persist and list isolates customers and shops', () => {
 const s=createStore(':memory:'); try {
 const a=s.createRequest(customer,input,'new');
 assert.deepEqual(a.details,input.details);
 assert.equal(s.listRequests(customer).length,1);
 assert.equal(s.listRequests(other).length,0);
 assert.equal(s.listRequests(staff).length,1);
 assert.equal(s.listRequests({...staff,shop:'other.myshopify.com'}).length,0);
 } finally {s.close();}
});
test('server rejects invalid dates, short lead time, too many tiers and invalid diameter',()=>{
 const s=createStore(':memory:');try {
 for(const d of [{pickupAt:'tomorrow'},{pickupAt:new Date(Date.now()+3600000).toISOString(),urgent:true},{pickupAt:new Date(Date.now()+2*86400000).toISOString()},{tiers:[input.details.tiers[0],input.details.tiers[0],input.details.tiers[0]]},{tiers:[{...input.details.tiers[0],diameter:100}]}]) {
 assert.throws(()=>s.createRequest(customer,{...input,details:{...input.details,...d}},'bad'),e=>e.code==='VALIDATION');
 }
 }finally{s.close();}
});
test('photo bytes are private, idempotent, capped and absent from JSON snapshots',()=>{
 const s=createStore(':memory:');try {
 const a=s.createRequest(customer,input,'new');
 const bytes=new Uint8Array([255,216,255,224,1,2,3]);
 const p=s.addPhoto(customer,a.id,{name:'referencia.jpg',mimeType:'image/jpeg',bytes},'photo');
 assert.equal(p.attachments.length,1);
 assert.equal(s.addPhoto(customer,a.id,{name:'referencia.jpg',mimeType:'image/jpeg',bytes},'photo').attachments.length,1);
 assert.deepEqual(s.getPhoto(staff,a.id,p.attachments[0].id).bytes,bytes);
 assert.throws(()=>s.getPhoto(other,a.id,p.attachments[0].id),e=>e.code==='NOT_FOUND');
 assert.equal(JSON.stringify(p).includes('bytes'),false);
 assert.throws(()=>s.addPhoto(customer,a.id,{name:'evil.svg',mimeType:'image/svg+xml',bytes},'bad'),e=>e.code==='VALIDATION');
 for(let i=0;i<2;i++)s.addPhoto(customer,a.id,{name:'x.jpg',mimeType:'image/jpeg',bytes},'p'+i);
 assert.throws(()=>s.addPhoto(customer,a.id,{name:'x.jpg',mimeType:'image/jpeg',bytes},'four'),e=>e.code==='CONFLICT');
 }finally{s.close();}
});
test('chef can close/reopen a date; requests honor Houston hours and closures',()=>{
 const s=createStore(':memory:');try{
 const date=input.details.pickupAt.slice(0,10);
 assert.throws(()=>s.setCalendar(customer,date,true,'close'),e=>e.code==='AUTH_REQUIRED');
 assert.equal(s.setCalendar(staff,date,true,'close').days[0].closed,true);
 assert.throws(()=>s.createRequest(customer,input,'new'),e=>e.code==='VALIDATION');
 assert.equal(s.setCalendar(staff,date,false,'open').days[0].closed,false);
 assert.equal(s.setCalendar(staff,date,true,'close').days[0].closed,false);
 s.createRequest(customer,input,'new');
 const late=new Date(future);late.setUTCHours(5);
 assert.throws(()=>s.createRequest(customer,{...input,details:{...input.details,pickupAt:late.toISOString()}},'late'),e=>e.code==='VALIDATION');
 }finally{s.close();}
});
