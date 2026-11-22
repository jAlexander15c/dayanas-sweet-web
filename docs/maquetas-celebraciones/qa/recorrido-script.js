
(() => {
  const root = document.getElementById('ds-celebraciones');
  const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
  const flavors = ['Chocolate','Vainilla','Capuchino','Fresa'];
  const fillings = ['Nutella','Ganache de chocolate','Guayaba','Coco','Dulce de leche','Crema pastelera de vainilla','Crema con fresas naturales','Tiramisú','Ferrero'];
  const covers = ['Merengue italiano','Whipped icing','Ganache de chocolate','Buttercream'];
  const palette = [['Rosa suave','#efb3c7'],['Blanco','#ffffff'],['Lavanda','#c4b3dd']];
  const state = {mode:'custom',step:0,floors:1,size:8,cover:'Buttercream',color:'Rosa suave',layers:[{a:'Vainilla',b:'Chocolate',c:'Guayaba',d:'Nutella'},{a:'Vainilla',b:'Vainilla',c:'Dulce de leche',d:'Dulce de leche'}]};
  let previews = [];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const opts = (list,value) => list.map(x => `<option${x===value?' selected':''}>${esc(x)}</option>`).join('');
  const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  function save(){
    const snapshot = {modelContent:{maqueta:'Celebraciones',tipo:state.mode,paso:state.step+1},privateContent:{mode:state.mode,step:state.step,floors:state.floors,size:state.size,cover:state.cover,color:state.color,layers:state.layers}};
    if(window.openai?.setWidgetState) Promise.resolve(window.openai.setWidgetState(snapshot)).catch(()=>{});
  }
  function restore(value){
    const v=value?.privateContent;
    if(!v || !['custom','catalog'].includes(v.mode))return;
    state.mode=v.mode;state.step=Number.isInteger(v.step)?Math.max(0,Math.min(v.step,2)):0;
    state.floors=v.floors===2?2:1;state.size=[6,8,10,12,14,16].includes(v.size)?v.size:8;
    if(covers.includes(v.cover))state.cover=v.cover;
    if(palette.some(x=>x[0]===v.color))state.color=v.color;
    if(Array.isArray(v.layers))v.layers.slice(0,2).forEach((l,i)=>{if(!l)return;['a','b'].forEach(k=>{if(flavors.includes(l[k]))state.layers[i][k]=l[k]});['c','d'].forEach(k=>{if(fillings.includes(l[k]))state.layers[i][k]=l[k]});});
  }
  restore(window.openai?.widgetState);
  function dateInfo(){
    const day=q('#ds-date').value, hour=Number(q('#ds-slot').value);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return {valid:false,text:'Elige una fecha de recogida.'};
    const at=Date.parse(`${day}T${String(hour).padStart(2,'0')}:00:00-06:00`), now=Date.parse('2026-11-03T10:00:00-06:00');
    const hours=(at-now)/3600000;
    if(!Number.isFinite(hours)||hours<24)return {valid:false,text:'Necesitamos al menos 24 horas de anticipación.'};
    const urgent=hours<(state.mode==='custom'?168:72);
    return {valid:true,urgent,at,text:urgent?'Solicitud urgente: Dayana revisará si puede prepararlo y fijará el recargo. Si la acepta, se paga completo.':state.mode==='custom'?'Plazo normal: Dayana revisará tu idea. Al aceptar la cotización, reservas con el 60% y pagas el saldo 24 horas antes de recoger.':'Plazo normal: puedes comprar el modelo por $45, sujeto a disponibilidad.'};
  }
  function renderLayers(){
    const count=state.mode==='catalog'?1:state.floors;
    q('#ds-flavors').innerHTML=state.layers.slice(0,count).map((l,i)=>`<fieldset><legend>${count===2?`Piso ${i+1} · `:''}Sabores y rellenos</legend><div class="ds-two">${[['a','Bizcocho 1',flavors],['b','Bizcocho 2',flavors],['c','Relleno 1',fillings],['d','Relleno 2',fillings]].map(([k,title,list])=>`<label>${title}<select data-layer="${i}" data-key="${k}">${opts(list,l[k])}</select></label>`).join('')}</div><p class="ds-muted">Puedes repetir sabores o combinar dos diferentes.</p></fieldset>`).join('');
  }
  function summaryHTML(){
    const count=state.mode==='catalog'?1:state.floors;
    const size=state.mode==='catalog'?'6″ × 10″ de alto':state.floors===2?'Dos pisos · tamaños propuestos por Dayana':`${state.size}″ de diámetro · un piso`;
    return `<p><strong>${state.mode==='custom'?'Personalizado':'Modelo de cumpleaños'}</strong></p><p>Redondo · ${size}</p>${state.layers.slice(0,count).map((l,i)=>`<p>${count===2?`<strong>Piso ${i+1}</strong><br>`:''}${esc(l.a)} + ${esc(l.b)}<br><span class="ds-muted">Rellenos: ${esc(l.c)} + ${esc(l.d)}</span></p>`).join('')}<p>Cobertura: ${esc(state.cover)}</p>${state.mode==='catalog'?`<p>Color: ${state.cover==='Ganache de chocolate'?'chocolate':esc(state.color)}</p><p class="ds-big">${money(45)}</p><p class="ds-muted">Una unidad en esta demostración. Recargo urgente, si aplica, por cotización.</p>`:'<p class="ds-muted">Altura y precio por cotización de Dayana.</p>'}`;
  }
  function updateSummary(){
    q('#ds-summary').innerHTML=summaryHTML();
    q('#ds-promise').textContent=state.mode==='custom'?'Podrás seguir tu cotización, conversar con Dayana y solicitar ajustes desde la web.':'Incluye velas de cortesía. La foto puede orientar un acabado sencillo del modelo.';
    q('#ds-date-status').textContent=dateInfo().text;
  }
  function review(){
    const di=dateInfo(), urgent=di.urgent;
    const decor=qa('[data-decor]:checked').map(el=>el.value);
    const comments=q('#ds-comments').value.trim();
    q('#ds-review').innerHTML=`<div>${summaryHTML()}</div><div><h3>Tu idea</h3><p>${esc(comments||'Sin comentarios adicionales.')}</p><p class="ds-muted">${previews.length} foto(s) de referencia${state.mode==='custom'?` · ${esc(decor.join(', ')||'Decoración por definir')}`:''}</p></div><div><h3>Recogida y contacto</h3><p>${esc(q('#ds-date').value)} · ${esc(q('#ds-slot').selectedOptions[0].textContent)} · Houston</p><p>${esc(q('#ds-name').value)}<br>${esc(q('#ds-email').value)}</p><p class="ds-muted">Dirección exacta pendiente de configurar; se mostrará antes del pago.</p></div><div class="ds-note">${esc(di.text)}${state.mode==='custom'||urgent?' Enviar esta solicitud no reserva cupo ni genera un cobro.':' El pedido se confirmará al pagar, si queda disponibilidad.'}</div>`;
  }
  function render(){
    const custom=state.mode==='custom';
    qa('[data-mode]').forEach(el=>el.setAttribute('aria-pressed',el.dataset.mode===state.mode));
    qa('[data-custom]').forEach(el=>el.hidden=!custom);
    qa('[data-catalog]').forEach(el=>el.hidden=custom);
    qa('[data-floors]').forEach(el=>el.setAttribute('aria-pressed',Number(el.dataset.floors)===state.floors));
    q('#ds-diameter').hidden=state.floors===2;
    q('#ds-height-note').textContent=state.floors===2?'Dayana propondrá la combinación de diámetros y la altura de cada piso según el diseño.':'Dayana propondrá la altura según tu diseño.';
    q('#ds-sizes').innerHTML=[6,8,10,12,14,16].map(n=>`<button class="cursor-interaction" type="button" data-size="${n}" aria-pressed="${state.size===n}" aria-label="${n} pulgadas">${n}″</button>`).join('');
    renderLayers();
    q('#ds-cover').innerHTML=opts(covers,state.cover);
    q('#ds-colors').innerHTML=palette.map(([name,hex])=>`<button class="ds-color cursor-interaction" type="button" data-color="${esc(name)}" aria-pressed="${name===state.color}"><span class="ds-swatch" style="--sample:${hex}"></span>${esc(name)}</button>`).join('');
    q('#ds-palette').hidden=custom||state.cover==='Ganache de chocolate';
    q('#ds-ganache-note').hidden=custom||state.cover!=='Ganache de chocolate';
    qa('[data-step]').forEach(el=>el.hidden=Number(el.dataset.step)!==state.step);
    qa('[data-step-marker]').forEach(el=>{if(Number(el.dataset.stepMarker)===state.step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
    q('#ds-back').hidden=state.step===0;
    q('#ds-next').textContent=['Continuar a tu idea','Elegir fecha y contacto','Revisar solicitud',(custom||dateInfo().urgent)?'Simular envío de solicitud':'Simular paso al pago'][state.step];
    q('#ds-error').hidden=true;
    updateSummary();if(state.step===3)review();
  }
  function error(text,el){q('#ds-error').textContent=text;q('#ds-error').hidden=false;if(el)el.focus();}
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||!root.contains(b))return;
    if(b.dataset.mode){state.mode=b.dataset.mode;state.step=0;render();save();}
    if(b.dataset.floors){state.floors=Number(b.dataset.floors);render();save();}
    if(b.dataset.size){state.size=Number(b.dataset.size);render();save();}
    if(b.dataset.color){state.color=b.dataset.color;render();save();}
  });
  q('#ds-flavors').addEventListener('change',e=>{if(e.target.dataset.layer===undefined)return;state.layers[Number(e.target.dataset.layer)][e.target.dataset.key]=e.target.value;updateSummary();save();});
  q('#ds-cover').addEventListener('change',e=>{state.cover=e.target.value;render();save();});
  q('#ds-date').addEventListener('change',updateSummary);q('#ds-slot').addEventListener('change',updateSummary);
  q('#ds-files').addEventListener('change',async e=>{
    const files=[...e.target.files];const results=await Promise.all(files.map(file=>new Promise(resolve=>{
      if(!file.type.startsWith('image/'))return resolve(null);
      const reader=new FileReader();reader.onload=()=>resolve({name:file.name,src:reader.result});reader.onerror=()=>resolve(null);reader.readAsDataURL(file);
    })));
    previews=results.filter(Boolean);q('#ds-photos').replaceChildren();
    previews.forEach(p=>{const fig=document.createElement('figure');fig.className='ds-photo';const img=document.createElement('img');img.src=p.src;img.alt='Referencia seleccionada';const cap=document.createElement('figcaption');cap.textContent=p.name;fig.append(img,cap);q('#ds-photos').append(fig);});
    if(previews.length!==files.length)error('No pudimos mostrar alguna imagen. Prueba con otra foto.');
  });
  q('#ds-back').addEventListener('click',()=>{state.step=Math.max(0,state.step-1);render();save();});
  q('#ds-form').addEventListener('submit',e=>{
    e.preventDefault();
    if(state.step===2){
      const info=dateInfo();if(!info.valid)return error(info.text,q('#ds-date'));
      if(!q('#ds-name').value.trim())return error('Escribe tu nombre para continuar.',q('#ds-name'));
      if(!q('#ds-email').value.trim()||!q('#ds-email').validity.valid)return error('Escribe un correo electrónico válido.',q('#ds-email'));
    }
    if(state.step<3){state.step++;render();save();return;}
    const quote=state.mode==='custom'||dateInfo().urgent;
    q('#ds-flow').hidden=true;q('#ds-success').hidden=false;
    q('#ds-success-title').textContent=quote?'Así se enviaría tu solicitud':'Así continuarías al pago';
    q('#ds-success-copy').textContent=quote?'En la web, Dayana recibiría tu idea, fotos y comentarios para preparar la cotización. Podrías consultar la respuesta y pedir ajustes desde tu solicitud.':'En la web, revisarías la dirección de recogida y completarías el pago en Shopify para confirmar el pedido, sujeto a disponibilidad.';
    q('#ds-success-note').textContent='Demostración terminada. No se ha enviado información, reservado una fecha ni realizado ningún cobro.';
    save();
  });
  q('#ds-return').addEventListener('click',()=>{q('#ds-flow').hidden=false;q('#ds-success').hidden=true;render();});
  window.addEventListener('openai:set_globals',e=>{if(e.detail?.globals?.widgetState){restore(e.detail.globals.widgetState);render();}});
  render();
})();


(() => {
  const root=document.getElementById('ds-celebraciones'), q=s=>root.querySelector(s);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
  const paid=9000; let role='customer', version=1, pending=null;
  let accepted={version:1,total:15000,base:15000,surcharge:0,display:'total',can:q('#ds-can').value,change:q('#ds-change').value,reply:'Prepararemos tu pastel en rosa suave con flores de fondant y un topper con el nombre Sofía. Tu anticipo está recibido y la fecha reservada.'};
  const history=[{...accepted,status:'Aceptada'}];
  const messages=[{author:'Cliente',text:'¿Podríamos agregar más flores alrededor del pastel?'},{author:'Dayana',text:'Sí, puedo revisar ese ajuste y enviarte la propuesta con el nuevo total.'}];
  function view(name,asChef=false){
    role=name==='chef'||asChef?'chef':'customer';
    q('#ds-flow').hidden=name!=='request';q('#ds-success').hidden=true;
    q('#ds-tracking').hidden=name!=='customer';q('#ds-chef').hidden=name!=='chef';
    root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===name));
    q('#ds-message-label').firstChild.textContent=role==='chef'?'Respuesta de Dayana':'Tu comentario';
    renderTracking();preview();
  }
  function balance(total){return total>=paid?`Saldo pendiente: ${usd(total-paid)}`:`Diferencia a tu favor: ${usd(paid-total)}. Dayana coordinará cómo resolverla; no se genera un reembolso automático.`;}
  function details(p){return p.display==='breakdown'?`<div class="ds-summary-row"><span>Pastel y personalización</span><strong>${usd(p.base)}</strong></div><div class="ds-summary-row"><span>Urgencia</span><strong>${usd(p.surcharge)}</strong></div>`:'';}
  function renderTracking(){
    q('#ds-approved-can').textContent=accepted.can;q('#ds-approved-change').textContent=accepted.change;q('#ds-approved-reply').textContent=accepted.reply;
    q('#ds-finances').innerHTML=`<div><span class="ds-money-label">Total vigente</span><strong class="ds-money-value">${usd(accepted.total)}</strong></div><div><span class="ds-money-label">Anticipo recibido</span><strong class="ds-money-value">${usd(paid)}</strong></div><div class="ds-money-balance"><span class="ds-money-label">${accepted.total>=paid?'Saldo pendiente':'A tu favor'}</span><strong class="ds-money-value">${usd(Math.abs(accepted.total-paid))}</strong></div>${accepted.display==='breakdown'?`<p class="ds-finance-detail">Pastel y personalización: ${usd(accepted.base)} · Urgencia: ${usd(accepted.surcharge)}</p>`:''}${accepted.total<paid?'<p class="ds-finance-detail">Dayana coordinará cómo resolver la diferencia a tu favor. No se genera un reembolso automático.</p>':''}`;
    q('#ds-pending').hidden=!pending;
    if(pending)q('#ds-pending').innerHTML=`<h3>Dayana propone un ajuste</h3><p>${esc(pending.reply)}</p><p><strong>Podemos preparar:</strong> ${esc(pending.can)}</p><p><strong>Cambios respecto a la referencia:</strong> ${esc(pending.change)}</p>${details(pending)}<p>Nuevo total: <strong>${usd(pending.total)}</strong></p><p>Si aceptas: <strong>${esc(balance(pending.total))}</strong></p><p>Tu anticipo de ${usd(paid)} y tu reserva se conservan.</p>${role==='customer'?'<button id="ds-accept" class="ds-primary" type="button" style="margin-top:16px">Aceptar ajuste de prueba</button>':'<p>Pendiente de aceptación del cliente.</p>'}`;
    q('#ds-thread').innerHTML=messages.map(m=>`<article><strong>${esc(m.author)}</strong><p style="white-space:pre-wrap">${esc(m.text)}</p></article>`).join('');
    q('#ds-history').innerHTML=history.map(p=>`<article><strong>Propuesta ${p.version} · ${esc(p.status)} · ${usd(p.total)}</strong><p>${esc(p.reply)}</p></article>`).join('');
  }
  function amounts(){
    if(q('#ds-price-mode').value==='same')return {base:accepted.base,surcharge:accepted.surcharge,total:accepted.total};
    const a=q('#ds-base'),b=q('#ds-surcharge');
    if(!a.value||!b.value||!a.validity.valid||!b.validity.valid)return null;
    const base=Math.round(Number(a.value)*100),surcharge=Math.round(Number(b.value)*100);
    if(!Number.isSafeInteger(base)||!Number.isSafeInteger(surcharge)||base<0||surcharge<0)return null;
    return {base,surcharge,total:base+surcharge};
  }
  function preview(){
    const same=q('#ds-price-mode').value==='same';q('#ds-price-fields').hidden=same;
    q('#ds-base').disabled=same;q('#ds-surcharge').disabled=same;
    const a=amounts();q('#ds-price-preview').textContent=a?`Total propuesto: ${usd(a.total)} · Recibido: ${usd(paid)} · ${balance(a.total)}`:'Escribe importes válidos, con un máximo de dos decimales.';
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.view)view(b.dataset.view);
    if(b.id==='ds-accept'&&pending&&role==='customer'){
      accepted={...pending};history.find(p=>p.version===pending.version).status='Aceptada';pending=null;
      messages.push({author:'Confirmación de prueba',text:`Ajuste aceptado. Total ${usd(accepted.total)}. ${balance(accepted.total)}. No se ha realizado ningún cobro.`});renderTracking();
    }
  });
  q('#ds-chef-comments').addEventListener('click',()=>view('customer',true));
  q('#ds-message-form').addEventListener('submit',e=>{e.preventDefault();const text=q('#ds-message').value.trim();if(!text)return;messages.push({author:role==='chef'?'Dayana':'Cliente',text});q('#ds-message').value='';renderTracking();});
  ['#ds-price-mode','#ds-base','#ds-surcharge'].forEach(s=>q(s).addEventListener('input',preview));
  q('#ds-proposal-form').addEventListener('submit',e=>{
    e.preventDefault();const a=amounts(), fields=['can','change','reply'];
    if(!a||fields.some(k=>!q('#ds-'+k).value.trim())){q('#ds-proposal-error').hidden=false;q('#ds-proposal-error').textContent='Completa los textos y revisa los importes.';return;}
    q('#ds-proposal-error').hidden=true;
    if(pending)history.find(p=>p.version===pending.version).status='Sustituida por una nueva propuesta';
    pending={...a,version:++version,display:q('#ds-display').value,can:q('#ds-can').value.trim(),change:q('#ds-change').value.trim(),reply:q('#ds-reply').value.trim()};
    history.push({...pending,status:'Pendiente de aceptación'});view('customer');
  });
  renderTracking();preview();view('customer');
})();

