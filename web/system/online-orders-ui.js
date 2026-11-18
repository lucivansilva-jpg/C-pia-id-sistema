const onlineOrderState={
 requests:[],
 summary:{awaiting_count:0,active_count:0,fulfillment_count:0,predicted_total_cents:0,predicted_delivery_fees_cents:0},
 filter:'awaiting_confirmation',
 query:'',
 selected:null,
 busy:false,
 loading:false,
 refreshSequence:0
};

const onlineModeLabel={table:'Mesa / local',pickup:'Retirada na loja',delivery:'Delivery'};
const onlineStatusLabel={
 awaiting_confirmation:'Aguardando confirmação',
 confirmed:'Confirmado',
 preparing:'Em preparo',
 ready_for_pickup:'Pronto p/ retirada',
 out_for_delivery:'Saiu p/ entrega',
 delivered:'Entregue',
 rejected:'Recusado',
 cancelled:'Cancelado'
};
const onlinePaymentLabel={
 cash:'Dinheiro na entrega/retirada',
 pix:'Pix (conferir comprovante)',
 card_on_delivery:'Cartão na entrega/retirada',
 pay_at_counter:'Pagar no balcão'
};

function onlineContractMods(){
 return window.IDContract?.modules({
  modules:live.settings?.modules??window.ERP_ACCOUNT?.business?.modules,
  businessKind:live.settings?.business_kind||window.ERP_ACCOUNT?.business?.business_kind
 })||{online_orders:false,delivery:false};
}

function onlineCanView(){
 return !isRetailMode()&&onlineContractMods().online_orders&&canOperate('payments.receive');
}

function onlineMatches(r){
 const f=onlineOrderState.filter;
 const isActive=['awaiting_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery'].includes(r.status);
 const isDone=['delivered','rejected','cancelled'].includes(r.status);
 if(f==='awaiting_confirmation'&&r.status!=='awaiting_confirmation')return false;
 if(f==='active'&&!isActive)return false;
 if(f==='done'&&!isDone)return false;
 const q=onlineOrderState.query.trim().toLowerCase();
 if(!q)return true;
 const hay=[
  r.public_code,
  r.customer_name,
  r.customer_phone,
  r.delivery_area_name,
  r.table_number?'mesa '+r.table_number:'',
  ...(r.items||[]).map(i=>i.name)
 ].join(' ').toLowerCase();
 return hay.includes(q);
}

function onlineOriginLabel(r){
 if(r.mode==='delivery')return 'Delivery · '+(r.delivery_area_name||'Entrega');
 if(r.mode==='pickup')return 'Retirada no estabelecimento';
 return r.table_number?'Mesa '+r.table_number:'Balcão (online)';
}

function onlineListHtml(){
 const list=onlineOrderState.requests.filter(onlineMatches);
 if(!list.length){
  return empty('▤','Nenhum pedido neste filtro','Quando os clientes enviarem pedidos pelo QR Code, as solicitações aparecerão aqui para conferência.');
 }
 return list.map(r=>`<button class="commandoption ${onlineOrderState.selected===r.id?'selected':''}" data-online-open="${escapeHTML(r.id)}"><div class="commandrowtitle"><strong>#${escapeHTML(r.public_code)} · ${escapeHTML(onlineOriginLabel(r))} ${r.status==='awaiting_confirmation'?'<small class="new-order">Aguardando</small>':''}</strong><span class="tag">${escapeHTML(onlineStatusLabel[r.status]||r.status)}</span></div><span>${escapeHTML(r.customer_name)} · ${escapeHTML(r.customer_phone)} · ${formatDate(r.created_at)}</span><div class="commandamount"><span>Previsto <b>${money(r.total_cents)}</b></span><span>${r.refund_cents>0&&r.paid_cents===0?'Estornado '+money(r.refund_cents):r.paid_cents>0?'Pago '+money(r.paid_cents):(r.delivery_fee_cents>0?'Taxa '+money(r.delivery_fee_cents):'Não recebido')}</span></div></button>`).join('');
}

function onlineDetailHtml(){
 const r=onlineOrderState.requests.find(x=>x.id===onlineOrderState.selected)||null;
 if(!r){
  return empty('▤','Escolha um pedido online','Confira os itens, o endereço e a forma de pagamento pretendida antes de confirmar.');
 }
 const writeBlocked=!!(window.ERP_ACCOUNT?.support&&!window.ERP_ACCOUNT.support.write_enabled);
 const canPrint=canOperate('orders.print');
 const awaiting=r.status==='awaiting_confirmation';
 const confirmedActive=['confirmed','preparing','ready_for_pickup','out_for_delivery'].includes(r.status);
 const canAdvanceTo=s=>{
  const map={confirmed:['preparing',r.mode==='delivery'?'out_for_delivery':'ready_for_pickup','delivered'],preparing:[r.mode==='delivery'?'out_for_delivery':'ready_for_pickup','delivered'],ready_for_pickup:['delivered'],out_for_delivery:['delivered']};
  return (map[r.status]||[]).includes(s);
 };

 return `<div class="commanddetailhead"><div><p class="eyebrow">PEDIDO ONLINE #${escapeHTML(r.public_code)}${r.converted_order_number?' · COMANDA #'+r.converted_order_number:''}</p><h2>${escapeHTML(onlineOriginLabel(r))}</h2><p class="sub">${escapeHTML(onlineModeLabel[r.mode]||r.mode)} · ${formatDate(r.created_at)}${r.estimated_minutes?' · Prazo aprox. '+r.estimated_minutes+' min':''}</p></div><span class="tag">${escapeHTML(onlineStatusLabel[r.status]||r.status)}</span></div>`+
 `<div class="settingsbody" style="padding:14px 22px;border-bottom:1px solid var(--line)">`+
 `<p><strong>Cliente:</strong> ${escapeHTML(r.customer_name)} · ${escapeHTML(r.customer_phone)}</p>`+
 (r.delivery_address?`<p><strong>Endereço:</strong> ${escapeHTML(r.delivery_address.street)}, ${escapeHTML(r.delivery_address.number)} · ${escapeHTML(r.delivery_address.area_name)}${r.delivery_address.complement?' ('+escapeHTML(r.delivery_address.complement)+')':''}${r.delivery_address.reference?' · Ref.: '+escapeHTML(r.delivery_address.reference):''}</p>`:'')+
 `<p><strong>Pagamento pretendido:</strong> ${escapeHTML(onlinePaymentLabel[r.payment_intent]||r.payment_intent)}${r.change_for_cents?' · Troco para '+money(r.change_for_cents):''}</p>`+
 `<p><strong>Situação financeira:</strong> ${r.refund_cents>0&&r.paid_cents===0?'Estornado '+money(r.refund_cents):r.refund_cents>0?'Recebido líquido '+money(r.paid_cents)+' (estornado '+money(r.refund_cents)+')':r.paid_cents>0?'Recebido '+money(r.paid_cents):'Não recebido no caixa (valor previsto)'}</p>`+
 (r.notes?`<p><strong>Observações do cliente:</strong> ${escapeHTML(r.notes)}</p>`:'')+
 (r.status_reason?`<p class="negative"><strong>Motivo (${r.status==='rejected'?'recusa':'cancelamento'}):</strong> ${escapeHTML(r.status_reason)}</p>`:'')+
 `</div>`+
 `<div class="commanddetailitems">${(r.items||[]).map(i=>`<div class="saleitem"><div><strong>${i.quantity}× ${escapeHTML(i.name)}</strong>${i.selections&&Object.keys(i.selections).length?`<small>${escapeHTML(Object.entries(i.selections).map(([k,v])=>k+': '+v).join('; '))}</small>`:''}${i.addons?.length?`<small>Adicionais: ${escapeHTML(i.addons.map(a=>a.name+' × '+a.quantity).join(', '))}</small>`:''}${i.note?`<small>Obs.: ${escapeHTML(i.note)}</small>`:''}<small>${money(i.unit_price_cents)} / un.</small></div><b>${money(i.quantity*i.unit_price_cents)}</b></div>`).join('')}</div>`+
 `<div class="commanddetailbottom">`+
 `<div class="totalrow"><span>Subtotal dos itens</span><span>${money(r.subtotal_cents)}</span></div>`+
 (r.delivery_fee_cents?`<div class="totalrow"><span>Taxa de entrega</span><span>${money(r.delivery_fee_cents)}</span></div>`:'')+
 `<div class="totalrow grand"><span>Total ${r.paid_cents>0?'':'previsto'}</span><strong>${money(r.total_cents)}</strong></div>`+
 (awaiting?`<button class="btn primary fullbtn" data-online-action="confirm" ${writeBlocked?'disabled':''}>Confirmar pedido e gerar comanda</button><button class="btn fullbtn" data-online-action="reject" ${writeBlocked?'disabled':''}>Recusar solicitação</button>`:'')+
 (confirmedActive&&r.converted_order_id&&canPrint?`<div class="printactions"><button class="btn" data-online-print="kitchen-complement">▤ Cozinha</button>${r.mode==='delivery'||r.mode==='pickup'?'<button class="btn" data-online-print="delivery">▤ Via entrega/retirada</button>':''}<button class="btn" data-online-print="bill">▤ Conferência</button></div>`:'')+
 (confirmedActive?`<div class="printactions">${canAdvanceTo('preparing')?`<button class="btn" data-online-status="preparing" ${writeBlocked?'disabled':''}>Iniciar preparo</button>`:''}${canAdvanceTo('ready_for_pickup')?`<button class="btn" data-online-status="ready_for_pickup" ${writeBlocked?'disabled':''}>Pronto p/ retirada</button>`:''}${canAdvanceTo('out_for_delivery')?`<button class="btn" data-online-status="out_for_delivery" ${writeBlocked?'disabled':''}>Saiu p/ entrega</button>`:''}${canAdvanceTo('delivered')?`<button class="btn primary" data-online-status="delivered" ${writeBlocked?'disabled':''}>Marcar entregue</button>`:''}</div>`:'')+
 (confirmedActive&&r.converted_order_id&&r.order_state!=='closed'&&r.paid_cents<r.total_cents?`<button class="btn primary fullbtn" data-online-checkout="${escapeHTML(r.converted_order_id)}">Fechar conta / receber no PDV →</button><p class="sub">Abre a comanda #${r.converted_order_number||''} no caixa para recebimento manual.</p>`:'')+
 (confirmedActive&&r.paid_cents===0&&!(r.refund_cents>0)&&r.order_state!=='closed'?`<button class="btn fullbtn" data-online-action="cancel" ${writeBlocked?'disabled':''}>Cancelar pedido (sem pagamento)</button>`:'')+
 `</div>`;
}

function drawOnlineOrders(){
 if(current!=='online')return;
 if(!onlineCanView()){
  main.innerHTML=empty('▤','Módulo indisponível','Os pedidos online estão disponíveis somente para Alimentação com o módulo contratado e permissão de caixa.');
  return;
 }
 const sum=onlineOrderState.summary||{};
 const mods=onlineContractMods();
 main.innerHTML=heading('Pedidos online e delivery','Solicitações do cardápio digital aguardam conferência antes de entrar no caixa e no faturamento.',`<button class="btn" data-online-refresh ${onlineOrderState.loading?'disabled':''}>↻ Atualizar</button>`)+
 `<div class="commandflow"><span>1. Conferir pedido online</span><span>→</span><span>2. Confirmar e enviar para cozinha</span><span>→</span><span>3. Receber manualmente no PDV</span></div>`+
 `<section class="stats" aria-label="Resumo operacional online">`+
 `<article class="stat"><div class="stathead">Aguardando confirmação</div><strong>${sum.awaiting_count||0}</strong><small>Ainda não entraram na cozinha</small></article>`+
 `<article class="stat"><div class="stathead">Em preparo / entrega</div><strong>${sum.fulfillment_count||0}</strong><small>Confirmados em andamento</small></article>`+
 `<article class="stat"><div class="stathead">Valor previsto ativo</div><strong>${money(sum.predicted_total_cents||0)}</strong><small>Não contabilizado no caixa</small></article>`+
 `<article class="stat"><div class="stathead">${mods.delivery?'Taxas previstas (delivery)':'Canal ativo'}</div><strong>${mods.delivery?money(sum.predicted_delivery_fees_cents||0):(live.settings?.online_orders_enabled?'Online ativo':'Somente consulta')}</strong><small>${mods.delivery?'Inclui taxas de entrega ativas':'Configure em Configurações'}</small></article>`+
 `</section>`+
 `<div class="commandworkspace"><section class="panel commandlistpanel"><div class="commandfilters"><input type="search" id="onlineSearch" placeholder="Buscar código, cliente, telefone ou bairro…" aria-label="Buscar pedido online" value="${escapeHTML(onlineOrderState.query)}"><select id="onlineFilter" aria-label="Filtrar pedidos online"><option value="awaiting_confirmation" ${onlineOrderState.filter==='awaiting_confirmation'?'selected':''}>Aguardando confirmação</option><option value="active" ${onlineOrderState.filter==='active'?'selected':''}>Todos ativos</option><option value="done" ${onlineOrderState.filter==='done'?'selected':''}>Finalizados / recusados</option><option value="all" ${onlineOrderState.filter==='all'?'selected':''}>Todos</option></select></div><div id="onlineList">${onlineListHtml()}</div><p class="sub commandlimit">Últimos 200 pedidos online · Atualização a cada 5 segundos.</p></section><section class="panel commanddetail" id="onlineDetail">${onlineDetailHtml()}</section></div>`;
}

async function refreshOnlineOrders(preserveLoading=false){
 if(!live.ready||!onlineCanView())return;
 const sequence=++onlineOrderState.refreshSequence;
 if(!preserveLoading){onlineOrderState.loading=true;if(current==='online'&&!document.querySelector('#onlineList'))drawOnlineOrders();}
 try{
  const result=await request('/api/online-orders');
  if(sequence!==onlineOrderState.refreshSequence)return;
  onlineOrderState.requests=result.requests||[];
  onlineOrderState.summary=result.summary||{awaiting_count:0,active_count:0,fulfillment_count:0,predicted_total_cents:0,predicted_delivery_fees_cents:0};
  const visible=onlineOrderState.requests.filter(onlineMatches);
  if(onlineOrderState.selected&&!onlineOrderState.requests.some(r=>r.id===onlineOrderState.selected)){
   onlineOrderState.selected=null;
  }
  if(!onlineOrderState.selected&&visible.length){
   onlineOrderState.selected=visible[0].id;
  }
 }finally{
  if(sequence===onlineOrderState.refreshSequence)onlineOrderState.loading=false;
  if(current==='online')drawOnlineOrders();
 }
}

function renderDeliveryAreaRow(area={}){
 const id=escapeHTML(area.id||'');
 const name=escapeHTML(area.name||'');
 const fee=priceValue(area.fee_cents??0);
 const min=priceValue(area.min_order_cents??0);
 const mins=Number.isInteger(area.estimated_minutes)?area.estimated_minutes:(live.settings.delivery_default_minutes||45);
 const active=area.active!==false;
 return `<div class="delivery-area-row" data-area-id="${id}" style="display:grid;grid-template-columns:minmax(140px,2fr) 95px 95px 80px auto auto;gap:8px;align-items:end;padding:10px 0;border-bottom:1px solid var(--line)"><label>Bairro / área *<input class="area-name" maxlength="80" value="${name}" placeholder="Ex.: Centro" required></label><label>Taxa (R$)<input class="area-fee" inputmode="decimal" value="${fee}" placeholder="0,00"></label><label>Mínimo (R$)<input class="area-min" inputmode="decimal" value="${min}" placeholder="0,00"></label><label>Prazo (min)<input class="area-mins" type="number" min="1" max="300" value="${mins}"></label><label class="removephotolabel" style="padding-bottom:10px"><input type="checkbox" class="area-active" ${active?'checked':''}> Ativa</label><button type="button" class="textbtn archivebtn" data-remove-delivery-area style="margin:0 0 10px">Remover</button></div>`;
}

function onlineSettingsSectionHtml(){
 if(isRetailMode())return '';
 const mods=onlineContractMods();
 if(!mods.online_orders)return '';
 const s=live.settings||{};
 const areas=Array.isArray(s.delivery_areas)?s.delivery_areas:[];
 return `<section class="panel settingsbody" style="margin-top:24px" id="onlineDeliveryConfig"><div class="panelhead" style="padding:0 0 16px;margin-bottom:16px"><h2>Pedidos online, retirada e delivery</h2><span class="tag">${s.online_orders_enabled?'Pedidos ativos':'Somente consulta'}</span></div><p>Defina como o cliente envia pedidos pelo cardápio digital. Nenhum pedido entra como venda paga automaticamente.</p><label class="removephotolabel"><input type="checkbox" id="onlineOrdersEnabled" ${s.online_orders_enabled?'checked':''}> Habilitar envio de pedidos pelo cardápio digital (QR Code)</label><label class="removephotolabel" style="margin-top:10px"><input type="checkbox" id="pickupEnabled" ${s.pickup_enabled?'checked':''}> Habilitar retirada no estabelecimento</label><label style="margin-top:12px">Instruções para retirada (opcional)<input id="pickupMessage" maxlength="300" placeholder="Ex.: Retire no balcão informando o número do pedido" value="${escapeHTML(s.pickup_message||'')}"></label>${mods.delivery?`<hr><h3>Delivery próprio e áreas de entrega</h3><p>Somente bairros ou áreas cadastradas e ativas poderão enviar pedidos de entrega.</p><label class="removephotolabel"><input type="checkbox" id="deliveryEnabled" ${s.delivery_enabled?'checked':''}> Habilitar pedidos com delivery próprio</label><div class="formrow"><label>Pedido mínimo geral (R$)<input id="deliveryMinOrder" inputmode="decimal" value="${priceValue(s.delivery_min_order_cents||0)}"></label><label>Prazo padrão (min)<input id="deliveryDefaultMinutes" type="number" min="1" max="300" value="${Number(s.delivery_default_minutes||45)}"></label></div><div id="deliveryAreasList">${areas.map(a=>renderDeliveryAreaRow(a)).join('')}</div><button type="button" class="btn" style="margin-top:12px" data-add-delivery-area>＋ Adicionar área / bairro</button>`:'<p class="sub" style="margin-top:12px">O módulo Delivery próprio não está contratado para este estabelecimento.</p>'}<div style="margin-top:18px"><button type="button" class="btn primary" data-save-online-settings ${!live.ready?'disabled':''}>Salvar pedidos online e delivery</button></div></section>`;
}

const prevOnlineConfig=config;
config=function(){
 return prevOnlineConfig()+onlineSettingsSectionHtml();
};

const prevOnlineRender=render;
render=function(){
 prevOnlineRender();
 if(current==='online'){
  drawOnlineOrders();
  if(live.ready&&onlineCanView()){
   refreshOnlineOrders(true).catch(err=>toast(err.message));
  }
 }
};

document.addEventListener('click',async e=>{
 const openBtn=e.target.closest('[data-online-open]');
 if(openBtn){
  onlineOrderState.selected=openBtn.dataset.onlineOpen;
  drawOnlineOrders();
  return;
 }

 const refreshBtn=e.target.closest('[data-online-refresh]');
 if(refreshBtn){
  refreshBtn.disabled=true;
  try{
   await refreshOnlineOrders();
  }catch(err){
   toast(err.message);
  }finally{
   refreshBtn.disabled=false;
  }
  return;
 }

 const addAreaBtn=e.target.closest('[data-add-delivery-area]');
 if(addAreaBtn){
  const list=document.querySelector('#deliveryAreasList');
  if(list){
   if(list.querySelectorAll('.delivery-area-row').length>=50){toast('Limite máximo de 50 áreas atingido.');return}
   list.insertAdjacentHTML('beforeend',renderDeliveryAreaRow({id:'area_'+crypto.randomUUID().slice(0,8),name:'',fee_cents:0,min_order_cents:0,estimated_minutes:Number(document.querySelector('#deliveryDefaultMinutes')?.value||45),active:true}));
  }
  return;
 }

 const remAreaBtn=e.target.closest('[data-remove-delivery-area]');
 if(remAreaBtn){
  remAreaBtn.closest('.delivery-area-row')?.remove();
  return;
 }

 const saveOnlineBtn=e.target.closest('[data-save-online-settings]');
 if(saveOnlineBtn){
  if(onlineOrderState.busy)return;
  saveOnlineBtn.disabled=true;
  onlineOrderState.busy=true;
  try{
   const mods=onlineContractMods();
   const payload={
    name:document.querySelector('#shopName')?.value||live.settings.name,
    mode:document.querySelector('#shopMode')?.value||live.settings.mode,
    paper:Number(document.querySelector('#settingPaper')?.value||live.settings.paper||80),
    legal_name:document.querySelector('#shopLegal')?.value??live.settings.legal_name??'',
    cnpj:document.querySelector('#shopCnpj')?.value??live.settings.cnpj??'',
    address:document.querySelector('#shopAddress')?.value??live.settings.address??'',
    phone:document.querySelector('#shopPhone')?.value??live.settings.phone??'',
    receipt_message:document.querySelector('#receiptMessage')?.value??live.settings.receipt_message??'',
    blind_close:document.querySelector('#blindClose')?document.querySelector('#blindClose').checked:!!live.settings.blind_close,
    online_orders_enabled:!!document.querySelector('#onlineOrdersEnabled')?.checked,
    pickup_enabled:!!document.querySelector('#pickupEnabled')?.checked,
    pickup_message:document.querySelector('#pickupMessage')?.value||''
   };
   if(mods.delivery){
    const areaRows=[...document.querySelectorAll('.delivery-area-row')];
    const areas=[];
    for(const row of areaRows){
     const name=row.querySelector('.area-name').value.trim();
     if(!name)throw Error('Informe o nome de todas as áreas cadastradas.');
     const feeCents=parseCents(row.querySelector('.area-fee').value||'0');
     const minCents=parseCents(row.querySelector('.area-min').value||'0');
     const mins=Number(row.querySelector('.area-mins').value||45);
     if(!Number.isInteger(mins)||mins<1||mins>300)throw Error('Prazo por área inválido (1 a 300 minutos).');
     areas.push({
      id:row.dataset.areaId||'area_'+crypto.randomUUID().slice(0,8),
      name,
      fee_cents:feeCents,
      min_order_cents:minCents,
      estimated_minutes:mins,
      active:!!row.querySelector('.area-active').checked
     });
    }
    const defMins=Number(document.querySelector('#deliveryDefaultMinutes')?.value||45);
    if(!Number.isInteger(defMins)||defMins<1||defMins>300)throw Error('Prazo padrão de delivery inválido (1 a 300 minutos).');
    payload.delivery_enabled=!!document.querySelector('#deliveryEnabled')?.checked;
    payload.delivery_min_order_cents=parseCents(document.querySelector('#deliveryMinOrder')?.value||'0');
    payload.delivery_default_minutes=defMins;
    payload.delivery_areas=areas;
   }
   await request('/api/settings',{method:'PUT',body:JSON.stringify(payload)});
   await reload();
   toast('Configurações de pedidos online e delivery salvas.');
  }catch(err){
   toast(err.message);
  }finally{
   onlineOrderState.busy=false;
   saveOnlineBtn.disabled=false;
  }
  return;
 }

 const printBtn=e.target.closest('[data-online-print]');
 if(printBtn){
  const r=onlineOrderState.requests.find(x=>x.id===onlineOrderState.selected);
  if(!r?.converted_order_id)return;
  printBtn.disabled=true;
  try{
   const kind=printBtn.dataset.onlinePrint;
   if(kind==='kitchen-complement'){
    const ord=await request('/api/orders/'+r.converted_order_id);
    await printDocumentForOrder(r.converted_order_id,kind,ord.order.version);
   }else{
    await printDocumentForOrder(r.converted_order_id,kind);
   }
  }catch(err){
   toast(err.message);
  }finally{
   printBtn.disabled=false;
  }
  return;
 }

 const checkoutBtn=e.target.closest('[data-online-checkout]');
 if(checkoutBtn){
  checkoutBtn.disabled=true;
  try{
   await receiveCommandInCash(checkoutBtn.dataset.onlineCheckout);
  }catch(err){
   toast(err.message);
  }finally{
   checkoutBtn.disabled=false;
  }
  return;
 }

 const statusBtn=e.target.closest('[data-online-status]');
 if(statusBtn){
  const r=onlineOrderState.requests.find(x=>x.id===onlineOrderState.selected);
  if(!r||onlineOrderState.busy)return;
  statusBtn.disabled=true;
  onlineOrderState.busy=true;
  try{
   await request('/api/online-orders/'+r.id+'/status',{method:'POST',body:JSON.stringify({status:statusBtn.dataset.onlineStatus})});
   await refreshOnlineOrders(true);
   toast('Status do pedido atualizado.');
  }catch(err){
   toast(err.message);
  }finally{
   onlineOrderState.busy=false;
   statusBtn.disabled=false;
  }
  return;
 }

 const actBtn=e.target.closest('[data-online-action]');
 if(actBtn){
  const r=onlineOrderState.requests.find(x=>x.id===onlineOrderState.selected);
  if(!r||onlineOrderState.busy)return;
  const act=actBtn.dataset.onlineAction;
  if(act==='confirm'){
   actBtn.disabled=true;
   onlineOrderState.busy=true;
   try{
    const res=await request('/api/online-orders/'+r.id+'/confirm',{method:'POST',body:'{}'});
    if(!isRetailMode()&&canOperate('tables.read'))request('/api/tables').then(t=>{if(t?.tables)live.tables=t.tables}).catch(()=>{});
    await refreshOnlineOrders(true);
    toast(res.appended?'Itens adicionados à comanda da mesa #'+res.number+'.':'Pedido confirmado! Comanda #'+res.number+' gerada.');
   }catch(err){
    toast(err.message);
   }finally{
    onlineOrderState.busy=false;
    actBtn.disabled=false;
   }
   return;
  }
  if(act==='reject'||act==='cancel'){
   const isReject=act==='reject';
   operationForm(
    isReject?'Recusar pedido online':'Cancelar pedido online',
    `<p>Pedido <strong>#${escapeHTML(r.public_code)}</strong> · ${escapeHTML(r.customer_name)} · ${money(r.total_cents)}</p><label>Motivo obrigatório *<input name="reason" required minlength="3" maxlength="200" placeholder="${isReject?'Ex.: produto esgotado ou fora do horário':'Ex.: cliente solicitou cancelamento'}"></label><p class="notice">${isReject?'O cliente verá o motivo no acompanhamento do pedido.':'Somente pedidos sem recebimento podem ser cancelados aqui. O estoque reservado será devolvido.'}</p>`,
    async f=>{
     await request('/api/online-orders/'+r.id+'/'+(isReject?'reject':'cancel'),{method:'POST',body:JSON.stringify({reason:f.get('reason')})});
     if(!isRetailMode()&&canOperate('tables.read'))request('/api/tables').then(t=>{if(t?.tables)live.tables=t.tables}).catch(()=>{});
     await refreshOnlineOrders(true);
     toast(isReject?'Solicitação recusada.':'Pedido cancelado e estoque restaurado.');
    }
   );
  }
 }
});

document.addEventListener('input',e=>{
 if(e.target.id==='onlineSearch'){
  onlineOrderState.query=e.target.value;
  const list=document.querySelector('#onlineList');
  if(list)list.innerHTML=onlineListHtml();
 }
});

document.addEventListener('change',e=>{
 if(e.target.id==='onlineFilter'){
  onlineOrderState.filter=e.target.value;
  const visible=onlineOrderState.requests.filter(onlineMatches);
  if(!visible.some(r=>r.id===onlineOrderState.selected))onlineOrderState.selected=visible[0]?.id||null;
  drawOnlineOrders();
 }
});

setInterval(()=>{
 if(live.ready&&current==='online'&&onlineCanView()&&!document.hidden&&!document.querySelector('#dialog').open&&!onlineOrderState.busy){
  refreshOnlineOrders(true).catch(()=>{});
 }
},5000);

window.IDSync?.on(scopes=>{
 if(live.ready&&current==='online'&&onlineCanView()&&!document.querySelector('#dialog').open&&!onlineOrderState.busy&&(scopes.has('online')||scopes.has('orders')||scopes.has('cash')||scopes.has('returns')||scopes.has('settings'))){
  refreshOnlineOrders(true).catch(()=>{});
 }
});

if(current==='online')render();
