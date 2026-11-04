import {randomUUID} from 'node:crypto';

/** Durable Object alarm driver. SQL owns the queue; storage owns the wake-up.
 * Every invocation performs at most batchSize reconciliations. No browser is
 * needed after a customer pays and no alarm creates a new initial checkout.
 */
export function createPaymentScheduler({store,service,storage,shop,now=Date.now,batchSize=2,additionalDue,additionalRun}={}) {
  if(!store||(!service&&typeof additionalRun!=='function')||!storage||typeof shop!=='string'||!Number.isInteger(batchSize)||batchSize<1||batchSize>5)throw new Error('UNAVAILABLE');
  const actor={shop,role:'staff',staffId:'__payment_reconciler__'};
  let activeRequests=0,tail=Promise.resolve();
  function serialized(fn){const result=tail.then(fn,fn);tail=result.catch(()=>{});return result;}
  async function ensureAlarm(){
    const pending=[service?store.nextPaymentDue(actor):null,additionalDue?.()??null].filter(value=>value!==null);
    const due=pending.length?Math.min(...pending):null;
    if(due===null){if(activeRequests===0)await storage.deleteAlarm();return;}
    const next=Math.max(now()+1000,due);
    if(await storage.getAlarm()!==next)await storage.setAlarm(next);
  }
  return Object.freeze({
    ensure:()=>serialized(ensureAlarm),
    async begin(){
      activeRequests++;
      try{await serialized(async()=>{const existing=await storage.getAlarm(),next=now()+300_000;if(existing===null||existing>next)await storage.setAlarm(next);});}
      catch(error){activeRequests--;throw error;}
    },
    async end(){activeRequests=Math.max(0,activeRequests-1);await serialized(ensureAlarm);},
    async run(){
      const jobs=service?store.getDuePaymentJobs(actor,now(),batchSize):[];
      for(const job of jobs){
        let failed=false;
        try{await service.sync(actor,job.id,`alarm-${randomUUID()}`);}
        catch{failed=true;}
        // A busy lease or a thrown read still moves behind other due work. An
        // already rescheduled/deleted job is never resurrected by this step.
        store.deferPaymentJob(actor,job.id,now(),failed);
      }
      try {await additionalRun?.();}
      finally {await serialized(ensureAlarm);}
    },
  });
}
