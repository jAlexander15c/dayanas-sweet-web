// Events are recorded in the same transaction as the staff change. Only the
// server resolves recipients and grants access; no request body selects either.
export async function runNotificationJobs({store,shop,email,resolveCustomer,now=Date.now}) {
  for(const due of store.getNotificationJobs(shop,now())) {
    let job=store.claimNotification(shop,due.id,now());if(!job)continue;
    let result,prepared=false;
    try {
      if(job.revoked)result={status:'failed'};
      else {
        const contact=job.contact??await resolveCustomer(job.customerId);
        if(!contact)result={status:'failed'};
        else {
          const capability=job.isGuest?email.notificationCapability(shop,job.id,job.requestId):null;
          job=store.prepareNotification(shop,job.id,{contact,capability},now());
          prepared=true;
          result=await email.deliverNotification(job,capability);
        }
      }
    } catch(error) {
      result={status:prepared?'unknown':['VALIDATION','NOT_FOUND','CONFLICT'].includes(error?.code)?'failed':'pending'};
    }
    let status=['pending','sent','failed','unknown'].includes(result?.status)?result.status:'unknown';
    if(status==='pending'&&job.attempts>=3)status='failed';
    store.finishNotification(shop,job.id,{status,now:now(),nextAttemptAt:status==='pending'?now()+60000*2**job.attempts:null});
  }
}
