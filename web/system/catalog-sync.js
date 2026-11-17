/* Uma assinatura por estabelecimento e somente enquanto a aba está visível. */
(() => {
  let unsubscribe = null, timer = null, startedFor = null, generation = 0;
  let revision = '', refreshing = false, dirty = false, pendingDraw = false;
  function drawCatalogue() {
    if (document.querySelector('#dialog')?.open || busy || posState.actionBusy) { pendingDraw = true; return; }
    pendingDraw = false;
    if (current === 'caixa') drawPos();
    else if (['produtos','cardapio'].includes(current)) render();
  }
  async function refresh(g) {
    if (g !== generation || document.hidden) return;
    if (refreshing) { dirty = true; return; }
    refreshing = true;
    try {
      const result = await request('/api/products');
      if (g !== generation) return;
      live.products = result.products;
      live.favorites = result.favorites;
      drawCatalogue();
    } catch { toast('Não foi possível atualizar o catálogo. Confira a conexão antes de lançar.'); }
    finally {
      refreshing = false;
      if (dirty) { dirty = false; clearTimeout(timer); timer = setTimeout(() => refresh(generation), 300); }
    }
  }
  function stop() { generation++; unsubscribe?.(); unsubscribe=null; clearTimeout(timer); startedFor=null; revision=''; }
  function start() {
    const fb=window.IDFirebase, account=window.ERP_ACCOUNT;
    if (!fb || !account?.business || document.hidden || !fb.sdk.onSnapshot) return;
    if (startedFor === account.business.id) return;
    stop(); startedFor=account.business.id;
    const g=generation;
    unsubscribe=fb.sdk.onSnapshot(fb.sdk.collection(fb.db,'businesses',startedFor,'products'), snapshot => {
      if (snapshot.metadata.hasPendingWrites || g!==generation) return;
      const next=snapshot.docs.map(d=>d.id+':'+d.data().version).sort().join('|');
      if (next===revision) return;
      revision=next; clearTimeout(timer);timer=setTimeout(()=>refresh(g),200);
    }, () => { toast('Sincronização do catálogo interrompida. Verifique sua conexão.'); });
  }
  document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
  window.addEventListener('erp-account-ready',start);
  window.addEventListener('pagehide',stop);
  document.querySelector('#dialog')?.addEventListener('close',()=>{if(pendingDraw)drawCatalogue();});
  start();
})();
