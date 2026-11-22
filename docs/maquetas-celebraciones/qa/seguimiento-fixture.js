// QA only: never loaded by a Shopify template.
(() => {
  const p = { version: 1, totalCents: 15000, baseCents: 15000, surchargeCents: 0, display: 'total', canPrepare: 'Pastel redondo de 8 pulgadas, flores de fondant y topper personalizado. Vainilla y chocolate, con guayaba y Nutella.', changes: 'Usaremos flores de fondant en lugar de flores naturales. Los tonos y la distribución pueden variar.', reply: 'Prepararemos tu pastel en rosa suave con el nombre Sofía. Tu anticipo está recibido y la fecha reservada.' };
  let snapshot = { id: 'qa-cake', version: 1, status: 'reserved', pickup: { label: 'Recogida · 14 de noviembre · Houston' }, requestText: 'Rosa suave, flores y un topper con el nombre Sofía.', acceptedProposal: p, pendingProposal: { ...p, version: 2, totalCents: 17000, baseCents: 17000, reply: 'Podemos agregar más flores. El ajuste es de $20.' }, payments: [{ id: 'qa-pay', amountCents: 9000, status: 'confirmed' }], comments: [{ id: 'qa-comment', author: 'Cliente', text: '¿Podemos agregar más flores?' }], history: [{ version: 1, status: 'Aceptada', totalCents: 15000, reply: p.reply }], permissions: { canComment: true, canAccept: true } };
  let error = null, delay = 0, calls = 0;
  const respond = async action => { calls++; if (delay) await new Promise(r => setTimeout(r, delay)); if (error) { const code = error; error = null; throw { code }; } action?.(); return structuredClone(snapshot); };
  const service = {
    getTracking: () => respond(),
    postComment: (_id, text) => respond(() => { snapshot.version++; snapshot.comments.push({ id: `qa-${snapshot.version}`, author: 'Cliente', text }); }),
    acceptProposal: () => respond(() => { snapshot.version++; snapshot.acceptedProposal = snapshot.pendingProposal; snapshot.pendingProposal = null; })
  };
  const controller = DSTracking.mountTracking(document.querySelector('[data-ds-tracking]'), service, snapshot.id);
  window.dsFixture = { controller, failNext: code => { error = code; }, setDelay: ms => { delay = ms; }, calls: () => calls, setSnapshot: value => { snapshot = value; }, snapshot: () => structuredClone(snapshot) };
})();
