import { randomUUID } from 'node:crypto';

// This queue is private to staff. Its recipient cannot come from a customer payload.
export const staffRecipient = 'Dayanaoramasgalano@gmail.com';
export function createStaffAlerts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS staff_alerts (
    shop TEXT NOT NULL,id TEXT NOT NULL,request_id TEXT NOT NULL,event_key TEXT NOT NULL,
    event TEXT NOT NULL,read_at INTEGER,email_status TEXT NOT NULL DEFAULT 'pending',
    due_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(shop,id),UNIQUE(shop,request_id,event_key));
    CREATE INDEX IF NOT EXISTS staff_alerts_due ON staff_alerts(shop,email_status,due_at);
    CREATE TABLE IF NOT EXISTS staff_alert_baseline(shop TEXT NOT NULL,request_id TEXT NOT NULL,payment_id TEXT NOT NULL,PRIMARY KEY(shop,request_id,payment_id));
    CREATE TABLE IF NOT EXISTS staff_alert_migrations(name TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO staff_alert_baseline(shop,request_id,payment_id)
      SELECT r.shop,r.id,json_extract(p.value,'$.id') FROM requests r,json_each(r.snapshot,'$.payments') p
      WHERE json_extract(p.value,'$.id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff_alert_migrations WHERE name='payment-baseline');
    INSERT OR IGNORE INTO staff_alert_migrations(name) VALUES('payment-baseline');`);
  const decode = row => ({id:row.id,requestId:row.request_id,...JSON.parse(row.event),read:row.read_at!==null,emailStatus:row.email_status,attempts:row.attempts});
  return {
    isBaselinePayment(shop,requestId,paymentId) {return !!db.prepare('SELECT 1 FROM staff_alert_baseline WHERE shop=? AND request_id=? AND payment_id=?').get(shop,requestId,paymentId);},
    enqueue(shop,snapshot,eventKey,event) {
      db.prepare(`INSERT OR IGNORE INTO staff_alerts(shop,id,request_id,event_key,event,due_at) VALUES(?,?,?,?,?,?)`)
        .run(shop,randomUUID(),snapshot.id,eventKey,JSON.stringify({reference:snapshot.reference||null,...event,createdAt:new Date().toISOString()}),Date.now());
    },
    list(shop) {
      return {alerts:db.prepare('SELECT * FROM staff_alerts WHERE shop=? ORDER BY (read_at IS NULL) DESC,rowid DESC LIMIT 50').all(shop).map(decode),
        unread:db.prepare('SELECT COUNT(*) AS n FROM staff_alerts WHERE shop=? AND read_at IS NULL').get(shop).n};
    },
    markRead(shop,id) {return db.prepare('UPDATE staff_alerts SET read_at=COALESCE(read_at,?) WHERE shop=? AND id=?').run(Date.now(),shop,id).changes;},
    nextDue(shop) {return db.prepare("SELECT MIN(due_at) AS due FROM staff_alerts WHERE shop=? AND email_status IN ('pending','sending')").get(shop)?.due??null;},
    claim(shop,now) {
      // A lost response may already have delivered mail. Never resend it blindly.
      db.prepare("UPDATE staff_alerts SET email_status='unknown',due_at=NULL WHERE shop=? AND email_status='sending' AND due_at<=?").run(shop,now);
      const row=db.prepare("SELECT * FROM staff_alerts WHERE shop=? AND email_status='pending' AND due_at<=? ORDER BY rowid LIMIT 1").get(shop,now);
      if(!row)return null;
      db.prepare("UPDATE staff_alerts SET email_status='sending',attempts=attempts+1,due_at=? WHERE shop=? AND id=?").run(now+60000,shop,row.id);
      return {...decode(row),attempts:row.attempts+1};
    },
    finish(shop,id,status,now) {
      const row=db.prepare("SELECT attempts FROM staff_alerts WHERE shop=? AND id=? AND email_status='sending'").get(shop,id);
      if(!row)return;
      if(!['sent','pending','failed','unknown'].includes(status))status='unknown';
      if(status==='pending'&&row.attempts>=3)status='failed';
      db.prepare('UPDATE staff_alerts SET email_status=?,due_at=? WHERE shop=? AND id=?').run(status,status==='pending'?now+60000*2**row.attempts:null,shop,id);
    }
  };
}

export function buildStaffMessage(job,{shop,clientId}) {
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!clientId||!['comment','payment'].includes(job.kind)||!/^[a-f0-9-]{36}$/.test(job.id))throw Error('Invalid staff notification');
  const reference=/^DS-\d{6,12}$/.test(job.reference||'')?job.reference:'Solicitud de pastel';
  const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const subject=`${job.kind==='comment'?'Nuevo mensaje de la clienta':'Pago confirmado'} · ${reference}`;
  const link=`https://admin.shopify.com/store/${shop.replace('.myshopify.com','')}/apps/${encodeURIComponent(clientId)}?solicitud=${encodeURIComponent(job.requestId)}`;
  const body=job.kind==='comment'?'La clienta respondió. Revisa su mensaje en el panel.':`Se confirmó un pago de ${money(job.amountCents)}.\nSaldo pendiente al confirmar: ${money(job.balanceDueCents)}.`;
  const content=`Hola Dayana,\n\n${subject}\n\n${body}\n\nAbre la solicitud en el panel de Shopify:\n${link}\n\nNecesitas iniciar sesión con una cuenta autorizada.\n\nDayana's Sweet`;
  return [`From: Dayana's Sweet <info@dayanassweet.com>`,`To: <${staffRecipient}>`,'Reply-To: <info@dayanassweet.com>',`Subject: ${subject}`,`Message-ID: <notice-${job.id}@dayanassweet.com>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(content).toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n');
}

export async function runStaffAlertJobs({store,shop,clientId,send,now=Date.now}) {
  for(let n=0;n<2;n++) {
    const job=store.claimStaffAlert(shop,now());if(!job)break;
    let result;
    try {result=await send({recipient:staffRecipient,message:buildStaffMessage(job,{shop,clientId})});}
    catch {result={status:'unknown'};}
    store.finishStaffAlert(shop,job.id,result?.status,now());
  }
}
