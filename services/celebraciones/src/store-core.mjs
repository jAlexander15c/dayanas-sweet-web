import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { hashCapability, validateGuestContact, guestRecipientKey } from './guest-access.mjs';

const ERROR_CODES = new Set(['AUTH_REQUIRED', 'NOT_FOUND', 'CONFLICT', 'VALIDATION', 'UNAVAILABLE', 'RATE_LIMITED']);
const guestActors = new WeakMap();
const MAX_CENTS = 100000000;
const CREATE_SCOPE = '__create__';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function guarded(fn) {
  try { return fn(); }
  catch (error) {
    if (ERROR_CODES.has(error?.code)) throw error;
    fail('UNAVAILABLE');
  }
}

function text(value, { empty = false, limit = 2000 } = {}) {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) fail('VALIDATION');
  return value.trim();
}

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length
      || !keys.every(key => Object.hasOwn(value, key))) fail('VALIDATION');
}

function identity(actor) {
  if(actor&&guestActors.has(actor))return guestActors.get(actor);
  if (!actor || typeof actor.shop !== 'string' || !actor.shop.trim() || actor.shop.length > 255) fail('AUTH_REQUIRED');
  const isStaff = actor.role === 'staff';
  const id = isStaff ? actor.staffId : actor.customerId;
  if (typeof id !== 'string' || !id.trim() || id.length > 255
      || (isStaff && actor.customerId !== undefined)
      || (!isStaff && (actor.role !== undefined || actor.staffId !== undefined))) fail('AUTH_REQUIRED');
  return { shop: actor.shop, id, isStaff, principal: `${isStaff ? 'staff' : 'customer'}:${id}` };
}

function requestId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail('VALIDATION');
}

function operationKey(operationId) {
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) fail('VALIDATION');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function payloadHash(action, payload) {
  return createHash('sha256').update(JSON.stringify([action, canonical(payload)])).digest('hex');
}

function proposalInput(input) {
  object(input, ['baseCents', 'surchargeCents', 'display', 'canPrepare', 'changes', 'reply']);
  for (const field of ['baseCents', 'surchargeCents']) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0 || input[field] > MAX_CENTS) fail('VALIDATION');
  }
  if (input.baseCents + input.surchargeCents > MAX_CENTS || !['total', 'breakdown'].includes(input.display)) fail('VALIDATION');
  return {
    baseCents: input.baseCents, surchargeCents: input.surchargeCents,
    totalCents: input.baseCents + input.surchargeCents, display: input.display,
    canPrepare: text(input.canPrepare), changes: text(input.changes, { empty: true }), reply: text(input.reply),
  };
}

function detailsInput(value) {
  object(value, ['pickupAt', 'urgent', 'tiers', 'coating', 'decorations']);
  const pickupTime = Date.parse(value.pickupAt);
  if (typeof value.pickupAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.pickupAt) || !Number.isFinite(pickupTime) || typeof value.urgent !== 'boolean'
      || pickupTime < Date.now() + (value.urgent ? 1 : 7) * 86400000 || pickupTime > Date.now() + 366 * 86400000) fail('VALIDATION');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(pickupTime)).map(p=>[p.type,p.value]));
  const minutes = Number(parts.hour)*60+Number(parts.minute);
  if(minutes<480 || minutes>1080) fail('VALIDATION');
  if (!Array.isArray(value.tiers) || value.tiers.length < 1 || value.tiers.length > 2) fail('VALIDATION');
  const pair = values => {
    if (!Array.isArray(values) || values.length !== 2) fail('VALIDATION');
    return values.map(v => text(v, { limit: 100 }));
  };
  const tiers = value.tiers.map(tier => {
    object(tier, ['diameter', 'sponges', 'fillings']);
    if (!(tier.diameter === null && value.tiers.length === 2) && (!Number.isInteger(tier.diameter) || tier.diameter < 6 || tier.diameter > 16)) fail('VALIDATION');
    return { diameter: tier.diameter, sponges: pair(tier.sponges), fillings: pair(tier.fillings) };
  });
  if (!Array.isArray(value.decorations) || value.decorations.length > 10) fail('VALIDATION');
  return { pickupAt: new Date(pickupTime).toISOString(), urgent: value.urgent, tiers, coating: text(value.coating, {limit: 100}), decorations: value.decorations.map(v => text(v, {limit:100})) };
}

function photoInput(input) {
  const name = text(input.name, {limit:150});
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > 2 * 1024 * 1024) fail('VALIDATION');
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if (!((input.mimeType==='image/jpeg' && jpeg) || (input.mimeType==='image/png' && png) || (input.mimeType==='image/webp' && webp))) fail('VALIDATION');
  return { name, mimeType: input.mimeType, bytes };
}

/** Shared synchronous persistence. Callers must authenticate actors before invoking this API. */
export function createStoreWithDatabase(db, { transaction: runTransaction } = {}) {
  return guarded(() => {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
          shop TEXT NOT NULL,
          id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version > 0),
          snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
          PRIMARY KEY (shop, id)
        );
        CREATE TABLE IF NOT EXISTS operations (
          shop TEXT NOT NULL,
          principal TEXT NOT NULL,
          request_id TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          result_request_id TEXT NOT NULL,
          PRIMARY KEY (shop, principal, request_id, operation_id),
          FOREIGN KEY (shop, result_request_id) REFERENCES requests(shop, id)
        );
        CREATE TABLE IF NOT EXISTS guest_access (
          shop TEXT NOT NULL, request_id TEXT NOT NULL, capability_hash TEXT NOT NULL,
          reference TEXT NOT NULL, revoked_at INTEGER,
          PRIMARY KEY(shop,request_id), UNIQUE(shop,reference),
          FOREIGN KEY(shop,request_id) REFERENCES requests(shop,id)
        );
        CREATE TABLE IF NOT EXISTS guest_sequences (shop TEXT PRIMARY KEY, value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS guest_creations (shop TEXT NOT NULL,request_id TEXT NOT NULL,rate_key TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(shop,request_id));
        CREATE INDEX IF NOT EXISTS guest_creations_rate ON guest_creations(rate_key,created_at);
        CREATE TABLE IF NOT EXISTS guest_email_jobs (
          shop TEXT NOT NULL,request_id TEXT NOT NULL,encrypted_access TEXT NOT NULL,
          status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due_at INTEGER,
          PRIMARY KEY(shop,request_id),FOREIGN KEY(shop,request_id) REFERENCES requests(shop,id)
        );
        CREATE TABLE IF NOT EXISTS photo_chunks (
          shop TEXT NOT NULL, request_id TEXT NOT NULL, photo_id TEXT NOT NULL,
          part INTEGER NOT NULL, bytes BLOB NOT NULL,
          PRIMARY KEY (shop,request_id,photo_id,part)
        );
        CREATE TABLE IF NOT EXISTS notification_jobs (
          shop TEXT NOT NULL,id TEXT NOT NULL,request_id TEXT NOT NULL,event TEXT NOT NULL,
          contact TEXT,capability_hash TEXT,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due_at INTEGER,
          PRIMARY KEY(shop,id),FOREIGN KEY(shop,request_id) REFERENCES requests(shop,id)
        );
        CREATE INDEX IF NOT EXISTS notification_jobs_due ON notification_jobs(shop,status,due_at);
        CREATE INDEX IF NOT EXISTS notification_jobs_access ON notification_jobs(shop,request_id,capability_hash);
        CREATE TABLE IF NOT EXISTS calendar_days (shop TEXT NOT NULL,date TEXT NOT NULL,closed INTEGER NOT NULL,PRIMARY KEY(shop,date));
        CREATE TABLE IF NOT EXISTS calendar_operations (shop TEXT NOT NULL,principal TEXT NOT NULL,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(shop,principal,operation_id));
        CREATE TABLE IF NOT EXISTS payment_states (
          shop TEXT NOT NULL, request_id TEXT NOT NULL, order_id TEXT, state TEXT NOT NULL CHECK(json_valid(state)),
          PRIMARY KEY(shop,request_id), UNIQUE(shop,order_id),
          FOREIGN KEY(shop,request_id) REFERENCES requests(shop,id)
        );
        CREATE TABLE IF NOT EXISTS payment_operations (
          shop TEXT NOT NULL, request_id TEXT NOT NULL, operation_id TEXT NOT NULL,
          action TEXT NOT NULL, proposal_version INTEGER NOT NULL, status TEXT NOT NULL,
          PRIMARY KEY(shop,request_id,operation_id),
          FOREIGN KEY(shop,request_id) REFERENCES requests(shop,id)
        );
        CREATE TABLE IF NOT EXISTS payment_jobs (
          shop TEXT NOT NULL,request_id TEXT NOT NULL,due_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(shop,request_id),FOREIGN KEY(shop,request_id) REFERENCES requests(shop,id)
        );
        CREATE INDEX IF NOT EXISTS payment_jobs_due ON payment_jobs(shop,due_at,request_id);
        INSERT OR IGNORE INTO payment_jobs(shop,request_id,due_at,attempts)
          SELECT p.shop,p.request_id,0,0 FROM payment_states p JOIN requests r ON r.shop=p.shop AND r.id=p.request_id
          WHERE json_extract(r.snapshot,'$.status')!='ready'
            AND json_extract(r.snapshot,'$.payment.stage') IN ('deposit','balance','syncing','review')
            AND (json_extract(p.state,'$.draftId') IS NOT NULL OR json_extract(p.state,'$.orderId') IS NOT NULL
              OR json_extract(p.state,'$.uncertainPhase')='draft-create' OR json_extract(p.state,'$.phase')='draft-create')
            AND (json_extract(p.state,'$.uncertainPhase') IS NULL OR json_extract(p.state,'$.uncertainPhase') IN ('draft-create','edit-commit','order-open')
              OR (json_extract(p.state,'$.uncertainPhase') IN ('edit-add','edit-incomplete') AND json_extract(p.state,'$.stagedIncrease.version')=json_extract(r.snapshot,'$.acceptedProposal.version'))
              OR (json_extract(p.state,'$.uncertainPhase') IN ('edit-discount','edit-incomplete') AND json_extract(p.state,'$.discountPlan.version')=json_extract(r.snapshot,'$.acceptedProposal.version')));
      `);
    } catch (error) { db.close(); throw error; }

    const selectRequest = db.prepare('SELECT customer_id, version, snapshot FROM requests WHERE shop=? AND id=?');
    const selectOperation = db.prepare(`SELECT payload_hash, result_request_id FROM operations
      WHERE shop=? AND principal=? AND request_id=? AND operation_id=?`);
    const insertOperation = db.prepare(`INSERT INTO operations
      (shop,principal,request_id,operation_id,payload_hash,result_request_id) VALUES (?,?,?,?,?,?)`);
    let closed = false;
    function calendar(actor) {
      return {days:db.prepare('SELECT date,closed FROM calendar_days WHERE shop=? ORDER BY date').all(actor.shop).map(row=>({date:row.date,closed:row.closed===1}))};
    }

    function transaction(fn) {
      return guarded(() => {
        if (runTransaction) return runTransaction(fn);
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = fn();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    }

    function load(actor, id) {
      const row = selectRequest.get(actor.shop, id);
      const guest=db.prepare('SELECT revoked_at FROM guest_access WHERE shop=? AND request_id=?').get(actor.shop,id);
      if (!row || (!actor.isStaff && (actor.isGuest ? actor.requestId!==id || !guest || guest.revoked_at!==null : guest || row.customer_id !== actor.id))) fail('NOT_FOUND');
      const snapshot = JSON.parse(row.snapshot);
      snapshot.version = row.version;
      return snapshot;
    }

    function view(actor, snapshot) {
      // Permissions belong to the current authenticated actor, never to saved JSON.
      return {
        ...snapshot,
        ...(snapshot.reference?{emailStatus:emailStatus(actor.shop,snapshot.id)}:{}),
        ...(snapshot.acceptedProposal && !snapshot.payment ? {payment:{url:null,stage:'deposit',reviewRequired:false}} : {}),
        permissions: {
          canComment: snapshot.status !== 'ready',
          canAccept: !actor.isStaff && snapshot.status !== 'ready' && snapshot.pendingProposal !== null,
        },
      };
    }

    function emailStatus(shop,id){const status=db.prepare('SELECT status FROM guest_email_jobs WHERE shop=? AND request_id=?').get(shop,id)?.status;return status==='sending'?'pending':status;}
    function shopKey(shop){if(typeof shop!=='string'||!shop.trim()||shop.length>255)fail('VALIDATION');return shop;}
    function epoch(now){if(!Number.isSafeInteger(now)||now<0)fail('VALIDATION');}
    function guestActor(shop,id){const actor=Object.freeze({shop,role:'guest',requestId:id});guestActors.set(actor,{shop,id:`guest:${id}`,isStaff:false,isGuest:true,requestId:id,principal:`guest:${id}`});return actor;}
    function emailJob(shop,id){
      const row=db.prepare('SELECT encrypted_access,attempts FROM guest_email_jobs WHERE shop=? AND request_id=?').get(shop,id);
      const snapshot=JSON.parse(selectRequest.get(shop,id).snapshot);
      return {id,reference:snapshot.reference,contact:snapshot.contact,encryptedAccess:row.encrypted_access,attempts:row.attempts};
    }
    function recoverEmailClaims(shop,now){db.prepare("UPDATE guest_email_jobs SET status='unknown',due_at=NULL,encrypted_access='' WHERE shop=? AND status='sending' AND due_at<=?").run(shop,now);}
    function recoverNotificationClaims(shop,now){db.prepare("UPDATE notification_jobs SET status='unknown',due_at=NULL WHERE shop=? AND status='sending' AND due_at<=?").run(shop,now);}
    function notificationJob(shop,id){
      const row=db.prepare('SELECT * FROM notification_jobs WHERE shop=? AND id=?').get(shop,id);
      const owner=selectRequest.get(shop,row.request_id);
      const guest=db.prepare('SELECT reference,revoked_at FROM guest_access WHERE shop=? AND request_id=?').get(shop,row.request_id);
      return {id,requestId:row.request_id,event:JSON.parse(row.event),contact:row.contact?JSON.parse(row.contact):null,
        reference:guest?.reference??null,isGuest:!!guest,revoked:guest?.revoked_at!=null,customerId:guest?null:owner.customer_id,attempts:row.attempts};
    }

    function paymentState(actor, id) {
      const row = db.prepare('SELECT state FROM payment_states WHERE shop=? AND request_id=?').get(actor.shop, id);
      return row ? JSON.parse(row.state) : null;
    }
    function updatePaymentJob(actor,snapshot,state) {
      const recoverable=!state.uncertainPhase||['draft-create','edit-commit','order-open'].includes(state.uncertainPhase)||(['edit-add','edit-incomplete'].includes(state.uncertainPhase)&&state.stagedIncrease?.version===snapshot.acceptedProposal?.version)||(['edit-discount','edit-incomplete'].includes(state.uncertainPhase)&&state.discountPlan?.version===snapshot.acceptedProposal?.version);
      const hasReference=state.draftId||state.orderId||state.uncertainPhase==='draft-create'||state.phase==='draft-create';
      if(snapshot.status!=='ready'&&['deposit','balance','syncing','review'].includes(snapshot.payment?.stage)&&recoverable&&hasReference){
        const delay=snapshot.payment.stage==='review'||state.uncertainPhase?3_600_000:300_000;
        const updatedAt=Number.isSafeInteger(state.updatedAt)?state.updatedAt:Date.now();
        db.prepare('INSERT INTO payment_jobs(shop,request_id,due_at,attempts) VALUES(?,?,?,0) ON CONFLICT(shop,request_id) DO UPDATE SET due_at=excluded.due_at,attempts=0').run(actor.shop,snapshot.id,updatedAt+delay);
      }else db.prepare('DELETE FROM payment_jobs WHERE shop=? AND request_id=?').run(actor.shop,snapshot.id);
    }
    function savePayment(actor, snapshot, state) {
      db.prepare('INSERT INTO payment_states(shop,request_id,order_id,state) VALUES(?,?,?,?) ON CONFLICT(shop,request_id) DO UPDATE SET order_id=excluded.order_id,state=excluded.state')
        .run(actor.shop,snapshot.id,state.orderId || null,JSON.stringify(state));
      snapshot.version += 1;
      db.prepare('UPDATE requests SET version=?,snapshot=? WHERE shop=? AND id=?').run(snapshot.version,JSON.stringify(snapshot),actor.shop,snapshot.id);
      updatePaymentJob(actor,snapshot,state);
    }

    function mutate(actorInput, id, operationId, action, payload, apply) {
      return guarded(() => {
        const actor = identity(actorInput);
        requestId(id);
        operationKey(operationId);
        const hash = payloadHash(action, payload);
        return transaction(() => {
          const snapshot = load(actor, id);
          const previous = selectOperation.get(actor.shop, actor.principal, id, operationId);
          if (previous) {
            if (previous.payload_hash !== hash) fail('CONFLICT');
            return view(actor, snapshot);
          }
          apply(actor, snapshot);
          if(['accept','setStatus'].includes(action)){
            const state=paymentState(actor,id);
            if(state)updatePaymentJob(actor,snapshot,{...state,updatedAt:Date.now()});
          }
          snapshot.version += 1;
          db.prepare('UPDATE requests SET version=?, snapshot=? WHERE shop=? AND id=?')
            .run(snapshot.version, JSON.stringify(snapshot), actor.shop, id);
          insertOperation.run(actor.shop, actor.principal, id, operationId, hash, id);
          if(actor.isStaff&&['propose','comment','setStatus'].includes(action)){
            const event={kind:action,status:snapshot.status,version:snapshot.version};
            db.prepare("INSERT INTO notification_jobs(shop,id,request_id,event,contact,status,due_at) VALUES(?,?,?,?,?,'pending',?)")
              .run(actor.shop,randomUUID(),id,JSON.stringify(event),snapshot.contact?JSON.stringify(snapshot.contact):null,Date.now());
          }
          return view(actor, snapshot);
        });
      });
    }

    return {
      createGuestRequest({shop}, input, contactInput, capability, operationId, {encryptedAccess,now}={}) {
        return guarded(()=>{
          shopKey(shop);operationKey(operationId);epoch(now);
          const digest=hashCapability(capability),contact=validateGuestContact(contactInput);
          const rateKey=guestRecipientKey(contact.email);
          text(encryptedAccess,{limit:8192});
          object(input,Object.hasOwn(input||{},'details')?['requestText','pickup','details']:['requestText','pickup']);object(input.pickup,['label']);
          const requestText=text(input.requestText,{limit:6000}),pickup={label:text(input.pickup.label)};
          const hash=payloadHash('createGuestRequest',{input,contact});
          return transaction(()=>{
            const principal=`guest-create:${digest}`,previous=selectOperation.get(shop,principal,CREATE_SCOPE,operationId);
            if(previous){if(previous.payload_hash!==hash)fail('CONFLICT');const actor=identity(guestActor(shop,previous.result_request_id));return view(actor,load(actor,previous.result_request_id));}
            if(db.prepare('SELECT COUNT(*) AS n FROM guest_creations WHERE rate_key=? AND created_at>?').get(rateKey,now-3600000).n>=5||db.prepare('SELECT COUNT(*) AS n FROM guest_creations WHERE created_at>?').get(now-86400000).n>=100)fail('RATE_LIMITED');
            const details=input.details===undefined?undefined:detailsInput(input.details);
            if(details){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(details.pickupAt));if(db.prepare('SELECT closed FROM calendar_days WHERE shop=? AND date=?').get(shop,date)?.closed===1)fail('VALIDATION');}
            db.prepare('INSERT INTO guest_sequences(shop,value) VALUES(?,1) ON CONFLICT(shop) DO UPDATE SET value=value+1').run(shop);
            const reference=`DS-${String(db.prepare('SELECT value FROM guest_sequences WHERE shop=?').get(shop).value).padStart(6,'0')}`;
            const id=randomUUID(),snapshot={id,reference,contact,version:1,status:'requested',pickup,requestText,acceptedProposal:null,pendingProposal:null,payments:[],comments:[],history:[],...(details?{details}:{})};
            db.prepare('INSERT INTO requests(shop,id,customer_id,version,snapshot) VALUES(?,?,?,?,?)').run(shop,id,`guest:${id}`,1,JSON.stringify(snapshot));
            db.prepare('INSERT INTO guest_access(shop,request_id,capability_hash,reference) VALUES(?,?,?,?)').run(shop,id,digest,reference);
            db.prepare("INSERT INTO guest_email_jobs(shop,request_id,encrypted_access,status,due_at) VALUES(?,?,?,'pending',?)").run(shop,id,encryptedAccess,now);
            db.prepare('INSERT INTO guest_creations(shop,request_id,rate_key,created_at) VALUES(?,?,?,?)').run(shop,id,rateKey,now);
            insertOperation.run(shop,principal,CREATE_SCOPE,operationId,hash,id);
            return view(identity(guestActor(shop,id)),snapshot);
          });
        });
      },
      authenticateGuest(shop,id,capability){
        return guarded(()=>{
          shopKey(shop);requestId(id);let digest;try{digest=hashCapability(capability);}catch{fail('NOT_FOUND');}
          const row=db.prepare('SELECT capability_hash,revoked_at FROM guest_access WHERE shop=? AND request_id=?').get(shop,id);
          if(!row||row.revoked_at!==null)fail('NOT_FOUND');
          const original=timingSafeEqual(Buffer.from(row.capability_hash,'hex'),Buffer.from(digest,'hex'));
          if(!original&&!db.prepare('SELECT 1 FROM notification_jobs WHERE shop=? AND request_id=? AND capability_hash=?').get(shop,id,digest))fail('NOT_FOUND');
          return guestActor(shop,id);
        });
      },
      getGuestEmailJobs(shop,now,limit=2){return guarded(()=>{shopKey(shop);epoch(now);if(!Number.isSafeInteger(limit)||limit<1||limit>10)fail('VALIDATION');return transaction(()=>{recoverEmailClaims(shop,now);return db.prepare("SELECT request_id AS id FROM guest_email_jobs WHERE shop=? AND status='pending' AND due_at<=? ORDER BY due_at,request_id LIMIT ?").all(shop,now,limit).map(({id})=>emailJob(shop,id));});});},
      claimGuestEmail(shop,id,now){return guarded(()=>{shopKey(shop);requestId(id);epoch(now);return transaction(()=>{recoverEmailClaims(shop,now);const row=db.prepare('SELECT status,due_at,attempts FROM guest_email_jobs WHERE shop=? AND request_id=?').get(shop,id);if(!row||row.status!=='pending'||row.due_at>now||row.attempts>=3)return null;db.prepare("UPDATE guest_email_jobs SET status='sending',attempts=attempts+1,due_at=? WHERE shop=? AND request_id=?").run(now+60000,shop,id);return emailJob(shop,id);});});},
      finishGuestEmail(shop,id,{status,nextAttemptAt,now}){return guarded(()=>{shopKey(shop);requestId(id);epoch(now);if(!['pending','sent','failed','unknown'].includes(status))fail('VALIDATION');return transaction(()=>{const row=db.prepare('SELECT status,attempts,due_at FROM guest_email_jobs WHERE shop=? AND request_id=?').get(shop,id);if(!row||row.status!=='sending')return;if(row.due_at<=now){recoverEmailClaims(shop,now);return;}if(status==='pending'){epoch(nextAttemptAt);if(nextAttemptAt<=now)fail('VALIDATION');if(row.attempts>=3)status='failed';}db.prepare('UPDATE guest_email_jobs SET status=?,due_at=?,encrypted_access=CASE WHEN ? THEN encrypted_access ELSE ? END WHERE shop=? AND request_id=?').run(status,status==='pending'?nextAttemptAt:null,status==='pending'?1:0,'',shop,id);});});},
      nextGuestEmailDue(shop){return guarded(()=>{shopKey(shop);return db.prepare("SELECT MIN(due_at) AS due FROM guest_email_jobs WHERE shop=? AND status IN ('pending','sending')").get(shop)?.due??null;});},
      getNotificationJobs(shop,now){return guarded(()=>{shopKey(shop);epoch(now);return transaction(()=>{
        recoverNotificationClaims(shop,now);
        return db.prepare("SELECT id FROM notification_jobs WHERE shop=? AND status='pending' AND due_at<=? ORDER BY due_at,rowid LIMIT 2").all(shop,now).map(({id})=>notificationJob(shop,id));
      });});},
      claimNotification(shop,id,now){return guarded(()=>{shopKey(shop);requestId(id);epoch(now);return transaction(()=>{
        recoverNotificationClaims(shop,now);
        const row=db.prepare('SELECT status,due_at,attempts FROM notification_jobs WHERE shop=? AND id=?').get(shop,id);
        if(!row||row.status!=='pending'||row.due_at>now||row.attempts>=3)return null;
        db.prepare("UPDATE notification_jobs SET status='sending',attempts=attempts+1,due_at=? WHERE shop=? AND id=?").run(now+60000,shop,id);
        return notificationJob(shop,id);
      });});},
      prepareNotification(shop,id,{contact,capability},now){return guarded(()=>{shopKey(shop);requestId(id);epoch(now);return transaction(()=>{
        const row=db.prepare('SELECT status,due_at FROM notification_jobs WHERE shop=? AND id=?').get(shop,id);
        if(!row||row.status!=='sending'||row.due_at<=now)fail('CONFLICT');
        const job=notificationJob(shop,id);if(job.revoked)fail('NOT_FOUND');
        const recipient=job.contact??validateGuestContact({...contact,phone:'0000000000'});
        const digest=job.isGuest?hashCapability(capability):null;
        db.prepare('UPDATE notification_jobs SET contact=?,capability_hash=? WHERE shop=? AND id=?').run(JSON.stringify(recipient),digest,shop,id);
        return {...job,contact:recipient};
      });});},
      finishNotification(shop,id,{status,nextAttemptAt,now}){return guarded(()=>{shopKey(shop);requestId(id);epoch(now);
        if(!['pending','sent','failed','unknown'].includes(status))fail('VALIDATION');
        return transaction(()=>{
          const row=db.prepare('SELECT status,due_at,attempts FROM notification_jobs WHERE shop=? AND id=?').get(shop,id);
          if(!row||row.status!=='sending')return;
          if(row.due_at<=now){recoverNotificationClaims(shop,now);return;}
          if(status==='pending'){epoch(nextAttemptAt);if(nextAttemptAt<=now)fail('VALIDATION');if(row.attempts>=3)status='failed';}
          db.prepare('UPDATE notification_jobs SET status=?,due_at=? WHERE shop=? AND id=?').run(status,status==='pending'?nextAttemptAt:null,shop,id);
        });
      });},
      nextNotificationDue(shop){return guarded(()=>{shopKey(shop);return db.prepare("SELECT MIN(due_at) AS due FROM notification_jobs WHERE shop=? AND status IN ('pending','sending')").get(shop)?.due??null;});},
      createRequest(actorInput, input, operationId) {
        return guarded(() => {
          const actor = identity(actorInput);
          operationKey(operationId);
          object(input, Object.hasOwn(input || {}, 'details') ? ['requestText', 'pickup', 'details'] : ['requestText', 'pickup']);
          object(input.pickup, ['label']);
          const requestText = text(input.requestText, {limit:6000});
          const pickup = { label: text(input.pickup.label) };
          const hash = payloadHash('createRequest', input);
          return transaction(() => {
            const previous = selectOperation.get(actor.shop, actor.principal, CREATE_SCOPE, operationId);
            if (previous) {
              const snapshot = load(actor, previous.result_request_id);
              if (previous.payload_hash !== hash) fail('CONFLICT');
              return view(actor, snapshot);
            }
            if (actor.isStaff || actor.isGuest) fail('CONFLICT');
            const details = input.details === undefined ? undefined : detailsInput(input.details);
            if(details){
              const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(details.pickupAt));
              if(db.prepare('SELECT closed FROM calendar_days WHERE shop=? AND date=?').get(actor.shop,date)?.closed===1) fail('VALIDATION');
            }
            const count = db.prepare('SELECT COUNT(*) AS n FROM requests WHERE shop=? AND customer_id=?').get(actor.shop,actor.id);
            if (count.n >= 100) fail('CONFLICT');
            const snapshot = {
              id: randomUUID(), version: 1, status: 'requested', pickup, requestText,
              acceptedProposal: null, pendingProposal: null, payments: [], comments: [], history: [],
            };
            if (details) snapshot.details = details;
            db.prepare('INSERT INTO requests(shop,id,customer_id,version,snapshot) VALUES (?,?,?,?,?)')
              .run(actor.shop, snapshot.id, actor.id, snapshot.version, JSON.stringify(snapshot));
            insertOperation.run(actor.shop, actor.principal, CREATE_SCOPE, operationId, hash, snapshot.id);
            return view(actor, snapshot);
          });
        });
      },

      getTracking(actorInput, id) {
        return guarded(() => {
          const actor = identity(actorInput);
          requestId(id);
          return view(actor, load(actor, id));
        });
      },

      // Internal server capability. Never route browser-provided state into these methods.
      getPaymentContext(actorInput, id) {
        return guarded(() => {
          const actor = identity(actorInput); requestId(id);
          const snapshot = load(actor,id);
          const owner = selectRequest.get(actor.shop,id).customer_id;
          const guest=!!db.prepare('SELECT request_id FROM guest_access WHERE shop=? AND request_id=?').get(actor.shop,id);
          return { snapshot: view(actor,snapshot), customerId: guest?null:owner, ...(guest?{ownerType:'guest'}:{}), shop: actor.shop, state: paymentState(actor,id) };
        });
      },

      claimPayment(actorInput, id, operationId, action, now) {
        return guarded(() => {
          const actor = identity(actorInput); requestId(id); operationKey(operationId);
          if (!['pay','sync'].includes(action) || !Number.isSafeInteger(now)) fail('VALIDATION');
          return transaction(() => {
            const snapshot = load(actor,id);
            if (!snapshot.acceptedProposal || snapshot.acceptedProposal.totalCents <= 0) fail('CONFLICT');
            let state = paymentState(actor,id);
            const previous = db.prepare('SELECT action,proposal_version,status FROM payment_operations WHERE shop=? AND request_id=? AND operation_id=?').get(actor.shop,id,operationId);
            if (previous && previous.action !== action) fail('CONFLICT');
            if (previous?.status === 'completed') return { claimed:false, snapshot:view(actor,snapshot) };
            if (state?.activeToken && state.leaseUntil > now) return { claimed:false, snapshot:view(actor,snapshot) };
            if (!state) state = { phase:'idle', originOperationId:operationId, originProposalVersion:snapshot.acceptedProposal.version,
              initialBaseCents:snapshot.acceptedProposal.totalCents, initialDepositCents:snapshot.details?.urgent ? snapshot.acceptedProposal.totalCents : Number((BigInt(snapshot.acceptedProposal.totalCents)*60n+99n)/100n), urgent:snapshot.details?.urgent === true,
              syncedProposalVersion:null, draftId:null, orderId:null, uncertainPhase:null, checkoutVersion:null };
            if (state.phase !== 'idle' && state.phase !== 'read') state.uncertainPhase = state.phase;
            if (state.editId && !state.editCommitted && !state.uncertainPhase) state.uncertainPhase='edit-incomplete';
            state.activeToken = randomUUID(); state.activeOperationId=operationId; state.leaseUntil=now+60_000; state.updatedAt=now;state.phase='read';
            snapshot.payment = { url:null, stage:'syncing', reviewRequired:!!state.uncertainPhase };
            if (!previous) db.prepare('INSERT INTO payment_operations(shop,request_id,operation_id,action,proposal_version,status) VALUES(?,?,?,?,?,?)').run(actor.shop,id,operationId,action,snapshot.acceptedProposal.version,'pending');
            savePayment(actor,snapshot,state);
            const guest=!!db.prepare('SELECT request_id FROM guest_access WHERE shop=? AND request_id=?').get(actor.shop,id);
            return { claimed:true, token:state.activeToken, context:{ snapshot:view(actor,snapshot), customerId:guest?null:selectRequest.get(actor.shop,id).customer_id, ...(guest?{ownerType:'guest'}:{}), shop:actor.shop, state } };
          });
        });
      },

      checkpointPayment(actorInput,id,token,statePatch,publicPatch = {}, complete = false) {
        return guarded(() => {
          const actor=identity(actorInput); requestId(id);
          return transaction(() => {
            const snapshot=load(actor,id), state=paymentState(actor,id);
            if (!state || state.activeToken !== token) fail('CONFLICT');
            Object.assign(state,statePatch);
            if (publicPatch.payment) snapshot.payment=publicPatch.payment;
            if (publicPatch.billing) snapshot.billing=publicPatch.billing;
            if (publicPatch.payments) snapshot.payments=publicPatch.payments;
            if (publicPatch.reserve && ['requested','quoted'].includes(snapshot.status)) snapshot.status='reserved';
            if (complete) {
              db.prepare('UPDATE payment_operations SET status=? WHERE shop=? AND request_id=? AND operation_id=?').run('completed',actor.shop,id,state.activeOperationId);
              state.activeToken=null; state.leaseUntil=0;
            }
            savePayment(actor,snapshot,state);
            return { snapshot:view(actor,snapshot), state };
          });
        });
      },

      nextPaymentDue(actorInput) {
        return guarded(()=>{
          const actor=identity(actorInput);if(!actor.isStaff)fail('AUTH_REQUIRED');
          return db.prepare("SELECT MIN(j.due_at) AS due FROM payment_jobs j JOIN requests r ON r.shop=j.shop AND r.id=j.request_id WHERE j.shop=? AND json_extract(r.snapshot,'$.status')!='ready'").get(actor.shop)?.due ?? null;
        });
      },

      getDuePaymentJobs(actorInput,now,limit=2) {
        return guarded(()=>{
          const actor=identity(actorInput);if(!actor.isStaff)fail('AUTH_REQUIRED');
          if(!Number.isSafeInteger(now)||!Number.isSafeInteger(limit)||limit<1||limit>5)fail('VALIDATION');
          return db.prepare("SELECT j.request_id AS id FROM payment_jobs j JOIN requests r ON r.shop=j.shop AND r.id=j.request_id WHERE j.shop=? AND j.due_at<=? AND json_extract(r.snapshot,'$.status')!='ready' ORDER BY j.due_at,j.request_id LIMIT ?").all(actor.shop,now,limit);
        });
      },

      deferPaymentJob(actorInput,id,now,failed=false) {
        return guarded(()=>{
          const actor=identity(actorInput);if(!actor.isStaff)fail('AUTH_REQUIRED');requestId(id);
          if(!Number.isSafeInteger(now)||typeof failed!=='boolean')fail('VALIDATION');
          return transaction(()=>{
            const row=db.prepare('SELECT attempts,due_at FROM payment_jobs WHERE shop=? AND request_id=?').get(actor.shop,id);
            if(!row||row.due_at>now)return;
            const attempts=failed?Math.min(row.attempts+1,4):0;
            const delay=failed?Math.min(300_000*2**attempts,3_600_000):300_000;
            db.prepare('UPDATE payment_jobs SET due_at=?,attempts=? WHERE shop=? AND request_id=?').run(now+delay,attempts,actor.shop,id);
          });
        });
      },

      listRequests(actorInput) {
        return guarded(() => {
          const actor = identity(actorInput);
          if(actor.isGuest)fail('AUTH_REQUIRED');
          const rows = actor.isStaff
            ? db.prepare('SELECT snapshot,version FROM requests WHERE shop=? ORDER BY rowid DESC LIMIT 100').all(actor.shop)
            : db.prepare('SELECT snapshot,version FROM requests r WHERE shop=? AND customer_id=? AND NOT EXISTS(SELECT 1 FROM guest_access g WHERE g.shop=r.shop AND g.request_id=r.id) ORDER BY rowid DESC LIMIT 100').all(actor.shop,actor.id);
          return rows.map(row => view(actor, {...JSON.parse(row.snapshot), version:row.version}));
        });
      },

      getCalendar(actorInput) { return guarded(()=>calendar(identity(actorInput))); },
      setCalendar(actorInput,date,closedDay,operationId) {
        return guarded(()=>{
          const actor=identity(actorInput);if(!actor.isStaff)fail('AUTH_REQUIRED');operationKey(operationId);
          if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||typeof closedDay!=='boolean')fail('VALIDATION');
          const hash=payloadHash('calendar',{date,closed:closedDay});
          return transaction(()=>{
            const previous=db.prepare('SELECT payload_hash FROM calendar_operations WHERE shop=? AND principal=? AND operation_id=?').get(actor.shop,actor.principal,operationId);
            if(previous){if(previous.payload_hash!==hash)fail('CONFLICT');return calendar(actor);}
            db.prepare('INSERT INTO calendar_days(shop,date,closed) VALUES(?,?,?) ON CONFLICT(shop,date) DO UPDATE SET closed=excluded.closed').run(actor.shop,date,closedDay?1:0);
            db.prepare('INSERT INTO calendar_operations(shop,principal,operation_id,payload_hash) VALUES(?,?,?,?)').run(actor.shop,actor.principal,operationId,hash);
            return calendar(actor);
          });
        });
      },

      addPhoto(actorInput, id, input, operationId) {
        const photo = photoInput(input);
        const digest = createHash('sha256').update(photo.bytes).digest('hex');
        return mutate(actorInput,id,operationId,'photo',{name:photo.name,mimeType:photo.mimeType,digest},(actor,snapshot)=>{
          if (actor.isStaff || snapshot.status==='ready' || (snapshot.attachments || []).length >= 3) fail('CONFLICT');
          const photoId = randomUUID();
          for(let offset=0,part=0;offset<photo.bytes.length;offset+=65536,part++) {
            db.prepare('INSERT INTO photo_chunks(shop,request_id,photo_id,part,bytes) VALUES(?,?,?,?,?)')
              .run(actor.shop,id,photoId,part,photo.bytes.slice(offset,offset+65536));
          }
          (snapshot.attachments ||= []).push({id:photoId,name:photo.name,mimeType:photo.mimeType,size:photo.bytes.length});
        });
      },

      getPhoto(actorInput,id,photoId) {
        return guarded(()=>{
          const actor=identity(actorInput); requestId(id); requestId(photoId);
          const snapshot=load(actor,id);
          const metadata=snapshot.attachments?.find(photo=>photo.id===photoId);
          if(!metadata) fail('NOT_FOUND');
          const rows=db.prepare('SELECT bytes FROM photo_chunks WHERE shop=? AND request_id=? AND photo_id=? ORDER BY part').all(actor.shop,id,photoId);
          const bytes=new Uint8Array(metadata.size);let offset=0;
          for(const row of rows){const part=new Uint8Array(row.bytes);bytes.set(part,offset);offset+=part.length;}
          if(offset!==metadata.size) fail('UNAVAILABLE');
          return {...metadata,bytes};
        });
      },

      comment(actorInput, id, value, operationId) {
        return mutate(actorInput, id, operationId, 'comment', { text: value }, (actor, snapshot) => {
          if (snapshot.status === 'ready') fail('CONFLICT');
          if (snapshot.comments.length >= 500) fail('CONFLICT');
          snapshot.comments.push({ id: randomUUID(), author: actor.isStaff ? 'Pastelera' : 'Cliente', text: text(value) });
        });
      },

      accept(actorInput, id, proposalVersion, operationId) {
        return mutate(actorInput, id, operationId, 'accept', { proposalVersion }, (actor, snapshot) => {
          if (!Number.isSafeInteger(proposalVersion) || proposalVersion <= 0) fail('VALIDATION');
          if (actor.isStaff || snapshot.status === 'ready' || snapshot.pendingProposal?.version !== proposalVersion) fail('CONFLICT');
          const state=paymentState(actor,id);
          if (state?.activeToken || (state && state.phase !== 'idle' && !state.uncertainPhase)) fail('CONFLICT');
          snapshot.acceptedProposal = snapshot.pendingProposal;
          snapshot.pendingProposal = null;
          if (snapshot.payment) snapshot.payment={url:null,stage:'syncing',reviewRequired:false};
          // Acceptance alone never proves payment or reserves production capacity.
        });
      },

      propose(actorInput, id, input, operationId) {
        return mutate(actorInput, id, operationId, 'propose', input, (actor, snapshot) => {
          if (!actor.isStaff || snapshot.status === 'ready') fail('CONFLICT');
          if (paymentState(actor,id)?.activeToken) fail('CONFLICT');
          const proposal = proposalInput(input);
          const previous = snapshot.pendingProposal ?? snapshot.acceptedProposal;
          const versions = [snapshot.pendingProposal?.version ?? 0, snapshot.acceptedProposal?.version ?? 0,
            ...snapshot.history.map(entry => entry.version)];
          if (previous && !snapshot.history.some(entry => entry.version === previous.version)) {
            snapshot.history.push({
              version: previous.version, status: snapshot.status,
              totalCents: previous.totalCents, reply: previous.reply,
            });
          }
          snapshot.pendingProposal = { version: Math.max(...versions) + 1, ...proposal };
          if (snapshot.status === 'requested') snapshot.status = 'quoted';
        });
      },

      setStatus(actorInput, id, status, operationId) {
        return mutate(actorInput, id, operationId, 'setStatus', { status }, (actor, snapshot) => {
          if (!['preparing', 'ready'].includes(status)) fail('VALIDATION');
          if (!actor.isStaff || !['reserved', 'preparing'].includes(snapshot.status) || status === snapshot.status) fail('CONFLICT');
          if (status === 'ready' && (!snapshot.billing || snapshot.billing.proposalVersion !== snapshot.acceptedProposal?.version || snapshot.billing.balanceDueCents !== 0 || snapshot.billing.netPaidCents < snapshot.billing.totalCents || snapshot.payment?.stage !== 'paid' || snapshot.payment.reviewRequired || snapshot.pendingProposal)) fail('CONFLICT');
          snapshot.status = status;
        });
      },

      close() {
        if (!closed) { db.close(); closed = true; }
      },
    };
  });
}
