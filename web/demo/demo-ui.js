(()=>{
 const urlParams=new URLSearchParams(location.search);
 const isRetail=urlParams.get('kind')==='retail';
 const rawParamMesa=Number(urlParams.get('mesa')||'');
 const prefilledMesa=!isRetail&&Number.isInteger(rawParamMesa)&&rawParamMesa>=1&&rawParamMesa<=9999?rawParamMesa:null;
 const bar=document.querySelector('#demoBar');
 function measure(){document.documentElement.style.setProperty('--demo-height',Math.ceil(bar.getBoundingClientRect().height)+'px')}if('ResizeObserver' in window)new ResizeObserver(measure).observe(bar);else window.addEventListener('resize',measure);measure();

 const demoMenuState={
  category:'',
  search:'',
  cart:[],
  mode:prefilledMesa?'table':'delivery',
  tableNumber:prefilledMesa?String(prefilledMesa):'5',
  areaId:'centro',
  street:'Rua das Palmeiras',
  number:'180',
  complement:'',
  reference:'',
  customerName:'Mariana Souza',
  customerPhone:'(11) 99999-1234',
  notes:'',
  paymentIntent:'cash',
  changeFor:'100,00',
  busy:false,
  trackerOrder:null
 };

 const DEMO_STATUS_LABELS={
  awaiting_confirmation:'Aguardando confirmação da loja',
  confirmed:'Pedido confirmado · na cozinha',
  preparing:'Em preparo',
  ready_for_pickup:'Pronto para retirada no balcão',
  out_for_delivery:'Saiu para entrega',
  delivered:'Entregue',
  rejected:'Solicitação recusada',
  cancelled:'Pedido cancelado'
 };

 function guide(){
  const d=document.querySelector('#dialog');if(d.open)d.close();
  d.innerHTML=isRetail
   ? `<div class="dialoghead"><h2>Conheça o ID Sistema — Varejo</h2><button class="btn" id="closeDemoGuide">Fechar</button></div><p>Você está na <strong>Vila Mix</strong>, uma loja de variedades fictícia com 10 produtos, estoque controlado e 30 dias de vendas no PDV.</p><div class="demo-guide">${[['inicio','1. Visão geral da loja','Acompanhe vendas, resultado estimado e indicadores da loja.'],['caixa','2. Venda direta no PDV','Experimente registrar uma venda no caixa. O caixa já está aberto.'],['produtos','3. Catálogo e estoque','Consulte produtos, códigos de barras e estoque por unidade.'],['relatorios','4. Relatórios e desempenho','Veja as vendas e o resultado financeiro.'],['financeiro','5. Gestão e financeiro','Explore contas a pagar, receber e despesas operacionais.'],['devolucoes','6. Trocas e devoluções','Simule devoluções e trocas de produtos vendidos.']].map(([route,title,text])=>`<a href="#${route}" data-demo-shortcut><strong>${title}</strong><small>${text}</small></a>`).join('')}</div><p class="demo-note">Demonstração pública de varejo. O botão Reiniciar exemplo restaura os dados.</p>`
   : `<div class="dialoghead"><h2>Conheça o ID Sistema</h2><button class="btn" id="closeDemoGuide">Fechar</button></div><p>Você está na <strong>Sabor da Vila</strong>, uma empresa fictícia com 10 produtos, 15 mesas e 30 dias de vendas. Os valores são exemplos calculados pelas regras do sistema.</p><div class="demo-guide">${[['inicio','1. Acompanhar o negócio','Veja vendas, custos, resultado estimado e pedidos online previstos.'],['cardapio','2. Cardápio digital (QR Code)','Simule o pedido do cliente na mesa, retirada ou delivery com taxa por bairro.'],['online','3. Pedidos online e delivery','Confira solicitações pendentes, aceite para gerar comanda, imprima e avance o status.'],['caixa','4. Experimentar uma venda','Escolha produtos com fotos e receba um pagamento simulado. O caixa já está aberto.'],['pedidos','5. Atender uma comanda','As mesas 3 e 7 têm pedidos. Consulte, confira a impressão e leve ao caixa.'],['config','6. Configurar online e delivery','Ajuste retirada, áreas/taxas de entrega e gere QR Code de mesa.']].map(([route,title,text])=>`<a href="#${route}" data-demo-shortcut><strong>${title}</strong><small>${text}</small></a>`).join('')}</div><p class="demo-note">Use o seletor no topo para experimentar como proprietário, caixa ou garçom (garçom não acessa Pedidos online). O botão Reiniciar exemplo restaura tudo.</p>`;
  d.showModal();d.querySelector('#closeDemoGuide').onclick=()=>d.close();d.querySelectorAll('[data-demo-shortcut]').forEach(a=>a.onclick=()=>d.close());
 }

 document.querySelector('#demoGuide').onclick=guide;
 document.querySelector('#demoReset').onclick=()=>location.replace('/demo/?kind='+(isRetail?'retail':'food')+'&reiniciar='+Date.now()+'#inicio');

 document.querySelector('#demoRole').onchange=async e=>{
  const selector=e.target;selector.disabled=true;
  try{if(busy||posState.actionBusy||document.querySelector('dialog[open]'))throw Error('Feche a janela atual antes de trocar de perfil.');const account=await DemoRuntime.setRole(selector.value);live.sessionUser=account.user;posState.draft=[];posState.order=null;posState.requestKey=crypto.randomUUID();posState.parkedDraftId=null;posState.table=null;posState.customerId=null;current=selector.value==='admin'?'inicio':selector.value==='cashier'?'caixa':isRetail?'caixa':'mesas';location.hash='#'+current;await reload();window.dispatchEvent(new Event('erp-account-ready'));toast('Perfil de demonstração: '+selector.options[selector.selectedIndex].text)}catch(err){selector.value=live.sessionUser?.role||'admin';toast(err.message)}finally{selector.disabled=false}
 };

 applyAppearance=function(){
  const color=live.settings.theme_color||(isRetail?'#2563eb':'#a44924');
  if(/^#[a-f0-9]{6}$/i.test(color)){document.documentElement.style.setProperty('--green',color);document.documentElement.style.setProperty('--brand',color)}
  const src=live.settings.logo_key?DemoRuntime.image(live.settings.logo_key):'/demo/assets/logo.svg';
  for(const img of document.querySelectorAll('.brand img,.publiclogo')){img.src=src;img.alt=isRetail?'Vila Mix · empresa de demonstração':'Sabor da Vila · empresa de demonstração'}
  const footer=document.querySelector('footer');if(footer)footer.firstChild.textContent=(live.settings.name||(isRetail?'Vila Mix':'Sabor da Vila'))+' · DEMONSTRAÇÃO ';
  const state=document.querySelector('.connection');if(state&&live.ready)state.textContent='Demonstração · dados fictícios';
  for(const label of document.querySelectorAll('.shop small'))label.textContent=live.sessionUser?.name||'Demonstração pública';
  if(isRetail){
   const waiterOpt=document.querySelector('#demoRole option[value="waiter"]');
   if(waiterOpt)waiterOpt.remove();
  }
 };

 const settings=config;
 config=function(){return settings().replace(location.origin+'/cardapio/?empresa=demonstracao',location.origin+'/demo/#cardapio')+'<p class="demo-note">Demonstração pública: configurações, equipe e uploads são temporários e não criam acessos reais.</p>'};

 const access=applyAccessUi;
 applyAccessUi=function(){
  access();
  for(const node of document.querySelectorAll('[data-menu-qr]'))node.hidden=isRetail;
  applyAppearance();
 };

 function renderDemoTrackerHtml(){
  const t=demoMenuState.trackerOrder;
  if(!t)return '';
  const isStopped=t.status==='rejected'||t.status==='cancelled';
  const steps=t.mode==='delivery'
   ?[['awaiting_confirmation','Recebido'],['confirmed','Confirmado'],['preparing','Preparo'],['out_for_delivery','Em entrega'],['delivered','Entregue']]
   :t.mode==='pickup'
   ?[['awaiting_confirmation','Recebido'],['confirmed','Confirmado'],['preparing','Preparo'],['ready_for_pickup','Pronto'],['delivered','Retirado']]
   :[['awaiting_confirmation','Recebido'],['confirmed','Confirmado'],['preparing','Preparo'],['delivered','Servido']];
  const idx=steps.findIndex(([k])=>k===t.status);
  return `<section class="demo-tracker-card" aria-live="polite"><div class="demo-tracker-head"><div><span class="pill">ACOMPANHAMENTO · ${escapeHTML(t.public_code)}</span><h2 style="margin:8px 0 4px">${escapeHTML(DEMO_STATUS_LABELS[t.status]||t.status)}</h2><p class="sub">${t.mode==='delivery'?'Delivery · '+escapeHTML(t.delivery_area_name):t.mode==='pickup'?'Retirada no estabelecimento':'Mesa '+(t.table_number||'balcão')}${t.estimated_minutes?' · Prazo aprox. '+t.estimated_minutes+' min':''}</p></div><div style="display:flex;gap:8px;flex-wrap:wrap">${canOperate('payments.receive')?'<a class="btn primary" href="#online">Gerenciar em Pedidos online →</a>':''}<button type="button" class="btn" data-demo-clear-tracker>Fechar acompanhamento</button></div></div>${isStopped?`<div class="demo-alert-box"><strong>${escapeHTML(DEMO_STATUS_LABELS[t.status]||t.status)}:</strong> ${escapeHTML(t.status_reason||'Entre em contato com a lanchonete.')}</div>`:`<div class="demo-tracker-steps">${steps.map(([,text],i)=>`<span class="demo-tracker-step ${idx>=i?'done':''}">${escapeHTML(text)}</span>`).join('')}</div>`}${t.mode==='pickup'&&live.settings.pickup_message?`<div class="demo-info-box"><strong>Retirada:</strong> ${escapeHTML(live.settings.pickup_message)}</div>`:''}<p class="sub" style="margin-top:8px">${(t.items||[]).reduce((s,i)=>s+i.quantity,0)} item(ns) · Subtotal ${money(t.subtotal_cents)}${t.delivery_fee_cents?' · Entrega '+money(t.delivery_fee_cents):''} · <strong>Total ${money(t.total_cents)}</strong></p></section>`;
 }

 function renderFoodCardapio(){
  const s=live.settings||{};
  const mods=window.IDContract?.modules({modules:s.modules,businessKind:s.business_kind})||{online_orders:false,delivery:false};
  const ordering=!!(mods.online_orders&&s.online_orders_enabled);
  const pickupOn=ordering&&!!s.pickup_enabled;
  const deliveryOn=ordering&&!!mods.delivery&&!!s.delivery_enabled;
  if(!pickupOn&&demoMenuState.mode==='pickup')demoMenuState.mode='table';
  if(!deliveryOn&&demoMenuState.mode==='delivery')demoMenuState.mode=pickupOn?'pickup':'table';

  const ps=(live.products||[]).filter(p=>p.active&&p.visible);
  const categories=[...new Set(ps.map(p=>p.category).filter(Boolean))];
  const q=demoMenuState.search.trim().toLowerCase();
  const filtered=ps.filter(p=>(!demoMenuState.category||p.category===demoMenuState.category)&&(!q||(p.name+' '+p.description).toLowerCase().includes(q)));

  const areas=(s.delivery_areas||[]).filter(a=>a.active!==false);
  const selectedArea=demoMenuState.areaId==='__unlisted__'?null:(areas.find(a=>a.id===demoMenuState.areaId)||areas[0]||null);
  if(demoMenuState.mode==='delivery'&&demoMenuState.areaId!=='__unlisted__'&&selectedArea)demoMenuState.areaId=selectedArea.id;

  const subtotal=demoMenuState.cart.reduce((sum,i)=>sum+i.unit_price_cents*i.quantity,0);
  const fee=demoMenuState.mode==='delivery'&&selectedArea?(selectedArea.fee_cents||0):0;
  const minDelivery=demoMenuState.mode==='delivery'&&selectedArea?Math.max(s.delivery_min_order_cents||0,selectedArea.min_order_cents||0):0;
  const belowMin=demoMenuState.mode==='delivery'&&selectedArea&&subtotal>0&&subtotal<minDelivery;
  const unlistedArea=demoMenuState.mode==='delivery'&&demoMenuState.areaId==='__unlisted__';
  const total=subtotal+fee;

  const imgSrc=s.logo_key?DemoRuntime.image(s.logo_key):'/demo/assets/logo.svg';
  return `<div class="public">`+
   `<img class="publiclogo" src="${escapeHTML(imgSrc)}" alt="${escapeHTML(s.name)}">`+
   heading(escapeHTML(s.name),ordering?'Cardápio digital · Simule um pedido por QR Code, retirada ou delivery próprio.':'Cardápio somente para consulta · Os pedidos online foram desativados em Configurações.')+
   `<div class="demo-note" style="margin:0 0 18px"><strong>Simulação interativa do cliente:</strong> envie um pedido abaixo e ele entrará em <strong>Pedidos online</strong> como solicitação aguardando confirmação (sem baixa automática no caixa).${prefilledMesa?' <strong>QR Code detectado para Mesa '+prefilledMesa+'.</strong>':''}</div>`+
   renderDemoTrackerHtml()+
   `<div class="${ordering?'demo-cardapio-layout':''}">`+
    `<section>`+
     `<div class="toolbar"><input type="search" id="demoMenuSearch" placeholder="Buscar no cardápio…" value="${escapeHTML(demoMenuState.search)}"></div>`+
     `<div class="tabs"><button class="btn category ${!demoMenuState.category?'selected':''}" data-demo-cat="">Todos</button>${categories.map(c=>`<button class="btn category ${demoMenuState.category===c?'selected':''}" data-demo-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join('')}</div>`+
     `${filtered.length?`<div class="productgrid">${filtered.map(p=>`<article class="productcard"><div class="photo">${p.image_url?`<img src="${escapeHTML(p.image_url)}" alt="${escapeHTML(p.name)}">`:'◇'}</div><div class="productbody"><small>${escapeHTML(p.category)}</small><h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.description)}</p>${p.options?.length?`<p class="choicesummary">${p.options.map(g=>escapeHTML(g.label)+': '+g.values.map(escapeHTML).join(' / ')).join('<br>')}</p>`:''}${p.addons?.length?`<p class="choicesummary">Adicionais: ${p.addons.map(a=>escapeHTML(a.name)+' (+'+money(a.price_cents)+')').join(' · ')}</p>`:''}<div class="productbottom"><strong>${money(p.price_cents)}</strong><span class="tag">${p.available?'Disponível':'Esgotado'}</span></div>${ordering&&p.available?`<button type="button" class="btn primary" style="margin-top:10px;width:100%" data-demo-add="${escapeHTML(p.id)}">＋ Adicionar ao pedido</button>`:''}</div></article>`).join('')}</div>`:`<div class="panel">${empty('◇','Nenhum produto encontrado','Ajuste a busca ou a categoria.')}</div>`}`+
    `</section>`+
    (ordering?`<aside class="panel settingsbody demo-cart-panel">`+
     `<div class="panelhead" style="padding:0 0 12px;margin-bottom:12px"><h2>Seu pedido</h2><span class="tag">${demoMenuState.cart.reduce((t,i)=>t+i.quantity,0)} itens</span></div>`+
     `<div class="demo-mode-tabs">`+
      `<button type="button" class="${demoMenuState.mode==='table'?'active':''}" data-demo-mode="table">Mesa / local</button>`+
      (pickupOn?`<button type="button" class="${demoMenuState.mode==='pickup'?'active':''}" data-demo-mode="pickup">Retirada</button>`:'')+
      (deliveryOn?`<button type="button" class="${demoMenuState.mode==='delivery'?'active':''}" data-demo-mode="delivery">Delivery</button>`:'')+
     `</div>`+
     (demoMenuState.mode==='table'?`<label>Número da mesa (QR Code)<input id="demoMenuTable" type="number" min="1" max="9999" value="${escapeHTML(demoMenuState.tableNumber)}" placeholder="Ex.: 5"></label>`:'')+
     (demoMenuState.mode==='pickup'&&s.pickup_message?`<div class="demo-info-box"><strong>Retirada no estabelecimento:</strong><br>${escapeHTML(s.pickup_message)}</div>`:'')+
     (demoMenuState.mode==='delivery'?`<label>Bairro / área de entrega<select id="demoMenuArea">${areas.map(a=>`<option value="${escapeHTML(a.id)}" ${demoMenuState.areaId===a.id?'selected':''}>${escapeHTML(a.name)} · Taxa ${money(a.fee_cents)}${a.estimated_minutes?' (~'+a.estimated_minutes+' min)':''}</option>`).join('')}<option value="__unlisted__" ${unlistedArea?'selected':''}>Outro bairro (não cadastrado — testar bloqueio)</option></select></label>${unlistedArea?'<div class="demo-alert-box">Não atendemos esta área no momento. Escolha uma área ativa cadastrada pela loja.</div>':''}${belowMin?`<div class="demo-alert-box">Pedido mínimo para entrega nesta área: <strong>${money(minDelivery)}</strong>.</div>`:''}<div class="formrow"><label>Rua / avenida *<input id="demoMenuStreet" maxlength="120" value="${escapeHTML(demoMenuState.street)}"></label><label>Número *<input id="demoMenuNumber" maxlength="20" value="${escapeHTML(demoMenuState.number)}"></label></div><div class="formrow"><label>Complemento<input id="demoMenuComplement" maxlength="80" value="${escapeHTML(demoMenuState.complement)}"></label><label>Referência<input id="demoMenuReference" maxlength="120" value="${escapeHTML(demoMenuState.reference)}"></label></div>`:'')+
     `<hr>`+
     (demoMenuState.cart.length
      ?demoMenuState.cart.map((item,idx)=>`<div class="demo-cart-item"><div><strong>${escapeHTML(item.name)}</strong>${item.addons?.length?`<small style="display:block">${escapeHTML(item.addons.map(a=>'+ '+a.name).join(', '))}</small>`:''}${item.note?`<small style="display:block">Obs.: ${escapeHTML(item.note)}</small>`:''}<div class="demo-cart-qty"><button type="button" data-demo-qty="-1" data-demo-idx="${idx}">−</button><span>${item.quantity}</span><button type="button" data-demo-qty="1" data-demo-idx="${idx}">＋</button></div></div><strong>${money(item.unit_price_cents*item.quantity)}</strong></div>`).join('')
      :'<p class="sub">Adicione produtos do cardápio para simular o pedido.</p>')+
     `<hr><label>Seu nome *<input id="demoMenuName" maxlength="80" value="${escapeHTML(demoMenuState.customerName)}"></label><label>Telefone / WhatsApp *<input id="demoMenuPhone" maxlength="30" value="${escapeHTML(demoMenuState.customerPhone)}"></label><label>Forma de pagamento pretendida<select id="demoMenuPay"><option value="cash" ${demoMenuState.paymentIntent==='cash'?'selected':''}>Dinheiro</option><option value="pix" ${demoMenuState.paymentIntent==='pix'?'selected':''}>Pix (conferido no atendimento)</option><option value="card_on_delivery" ${demoMenuState.paymentIntent==='card_on_delivery'?'selected':''}>Cartão na entrega / retirada</option><option value="pay_at_counter" ${demoMenuState.paymentIntent==='pay_at_counter'?'selected':''}>Pagar no balcão / caixa</option></select></label>${demoMenuState.paymentIntent==='cash'?`<label>Troco para (opcional, R$)<input id="demoMenuChange" inputmode="decimal" value="${escapeHTML(demoMenuState.changeFor)}" placeholder="Ex.: 100,00"></label>`:''}<label>Observações gerais<input id="demoMenuNotes" maxlength="300" value="${escapeHTML(demoMenuState.notes)}" placeholder="Ex.: caprichar no molho"></label>`+
     `<div class="totalrow" style="margin-top:12px"><span>Subtotal</span><span>${money(subtotal)}</span></div>`+
     (demoMenuState.mode==='delivery'&&selectedArea?`<div class="totalrow"><span>Taxa (${escapeHTML(selectedArea.name)})</span><span>${money(fee)}</span></div>`:'')+
     `<div class="totalrow grand"><span>Total previsto</span><strong>${money(total)}</strong></div>`+
     `<button type="button" class="btn primary fullbtn" id="demoMenuSubmit" ${!demoMenuState.cart.length||unlistedArea||belowMin||demoMenuState.busy?'disabled':''}>${demoMenuState.busy?'Enviando…':'Enviar pedido para confirmação'}</button>`+
     `<p class="sub">Não cria venda paga automática. O caixa confere e confirma em Pedidos online.</p>`+
    `</aside>`:'')+
   `</div></div>`;
 }

 async function refreshDemoTracker(){
  if(isRetail||!demoMenuState.trackerOrder||!canOperate('payments.receive'))return;
  try{
   const res=await request('/api/online-orders');
   const updated=(res.requests||[]).find(r=>r.id===demoMenuState.trackerOrder.id);
   if(updated&&JSON.stringify(updated)!==JSON.stringify(demoMenuState.trackerOrder)){
    demoMenuState.trackerOrder=updated;
    if(current==='cardapio')main.innerHTML=renderFoodCardapio();
   }
  }catch{}
 }

 function openDemoProductPicker(p){
  const groups=p.options||[],extras=p.addons||[];
  openForm('Adicionar ao pedido',
   `<p><strong>${escapeHTML(p.name)}</strong> · ${money(p.price_cents)}</p>`+
   groups.map((g,i)=>`<label>${escapeHTML(g.label)}${g.required?' *':''}<select name="opt_${i}" ${g.required?'required':''}><option value="">${g.required?'Selecione…':'Sem preferência'}</option>${g.values.map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('')}</select></label>`).join('')+
   (extras.length?`<h3 style="margin-top:14px">Adicionais</h3><div class="checkoptions">${extras.map((a,i)=>`<label><input type="checkbox" name="addon" value="${i}"> ${escapeHTML(a.name)} (+${money(a.price_cents)})</label>`).join('')}</div>`:'')+
   `<label>Observação do item<input name="note" maxlength="200" placeholder="Ex.: sem cebola"></label>`,
   async f=>{
    const selections={};
    groups.forEach((g,i)=>{const v=f.get('opt_'+i);if(v)selections[g.label]=v;});
    const addons=f.getAll('addon').map(i=>({...extras[Number(i)],quantity:1}));
    const note=String(f.get('note')||'').trim();
    const unit=p.price_cents+addons.reduce((t,a)=>t+a.price_cents*a.quantity,0);
    const sig=JSON.stringify({id:p.id,selections,addons,note});
    const existing=demoMenuState.cart.find(c=>c._sig===sig);
    if(existing){existing.quantity++;}else{demoMenuState.cart.push({_sig:sig,product_id:p.id,name:p.name,quantity:1,selections,addons,note,unit_price_cents:unit});}
    render();
   },
   {reload:false,submitLabel:'Adicionar',message:'Item adicionado ao pedido.'}
  );
 }

 menus.push(['ajuda','Ajuda e suporte']);icons.ajuda=icons.equipe;menuPermission.ajuda='profile.read';nav.insertAdjacentHTML('beforeend',`<a href="#ajuda" data-route="ajuda">${svg('ajuda')}Ajuda e suporte</a>`);
 const original=render;
 render=function(){
  original();
  if(current==='cardapio'&&!isRetail&&live.ready){
   main.innerHTML=renderFoodCardapio();
  }
  if(current==='ajuda')main.innerHTML=heading('Ajuda e suporte','Exemplo da área de atendimento ao cliente.')+'<section class="panel settingsbody"><h2>Conversa com o suporte</h2><p>No sistema contratado, o proprietário pode abrir reclamações, informar erros ou enviar sugestões.</p><p class="demo-note">Nenhum chamado ou e-mail é enviado pela demonstração.</p><button class="btn" id="demoHelpGuide">Ver roteiro de demonstração</button></section>';
  applyAppearance();
 };

 const originalTeam=teamPage;
 teamPage=function(){return originalTeam()+'<p class="demo-note">Equipe fictícia. Alterar nomes e permissões aqui não cria logins reais.</p>'};

 printDocumentForOrder=async function(id,kind,version){const complement=kind==='kitchen-complement';const result=complement?await request('/api/orders/'+id+'/kitchen-print',{method:'POST',body:JSON.stringify({request_key:crypto.randomUUID(),version})}):await request('/api/orders/'+id+'/print');const actual=complement&&result.print_kind==='first'?'kitchen':kind;showPrintPreview(buildReceiptHtml(result,actual));return result;};
 const receipt=buildReceiptHtml;buildReceiptHtml=function(data,type){return receipt(data,type).replace('</body>','<p style="text-align:center;font-weight:bold">DEMONSTRAÇÃO · SEM VALOR COMERCIAL</p></body>')};

 document.addEventListener('click',async e=>{
  if(e.target.closest('#demoHelpGuide')){guide();return}
  const qrBtn=e.target.closest('[data-menu-qr]');
  if(qrBtn&&!isRetail){
   e.preventDefault();e.stopImmediatePropagation();
   const rawMesa=Number(document.querySelector('#qrTableNumber')?.value||'');
   const hasMesa=Number.isInteger(rawMesa)&&rawMesa>=1&&rawMesa<=9999;
   const link=location.origin+'/demo/'+(hasMesa?'?mesa='+rawMesa:'')+'#cardapio';
   const qr=qrcode(0,'M');qr.addData(link);qr.make();
   const onlineActive=!!live.settings?.online_orders_enabled;
   showPrintPreview('<!doctype html><html lang="pt-BR"><head><title>Cardápio QR Code</title></head><body style="text-align:center;font:18px sans-serif"><h1>'+escapeHTML(live.settings.name)+'</h1>'+(hasMesa?'<h2>Mesa '+rawMesa+'</h2>':'')+'<p>'+(onlineActive?'Aponte a câmera para abrir o cardápio e pedir':'Aponte a câmera para consultar o cardápio')+'</p>'+qr.createSvgTag(5,8)+'<p>'+escapeHTML(link)+'</p><p>DEMONSTRAÇÃO · SEM VALOR COMERCIAL</p></body></html>');
   return;
  }
  if(isRetail)return;
  const catBtn=e.target.closest('[data-demo-cat]');
  if(catBtn){demoMenuState.category=catBtn.dataset.demoCat;main.innerHTML=renderFoodCardapio();return}
  const modeBtn=e.target.closest('[data-demo-mode]');
  if(modeBtn){demoMenuState.mode=modeBtn.dataset.demoMode;main.innerHTML=renderFoodCardapio();return}
  const addBtn=e.target.closest('[data-demo-add]');
  if(addBtn){
   const p=(live.products||[]).find(x=>x.id===addBtn.dataset.demoAdd);
   if(!p)return;
   if((p.options||[]).length||(p.addons||[]).length){openDemoProductPicker(p);}
   else{
    const sig=JSON.stringify({id:p.id,selections:{},addons:[],note:''});
    const existing=demoMenuState.cart.find(c=>c._sig===sig);
    if(existing)existing.quantity++;else demoMenuState.cart.push({_sig:sig,product_id:p.id,name:p.name,quantity:1,selections:{},addons:[],note:'',unit_price_cents:p.price_cents});
    main.innerHTML=renderFoodCardapio();
    toast(p.name+' adicionado ao pedido.');
   }
   return;
  }
  const qtyBtn=e.target.closest('[data-demo-qty]');
  if(qtyBtn){
   const idx=Number(qtyBtn.dataset.demoIdx),delta=Number(qtyBtn.dataset.demoQty);
   const item=demoMenuState.cart[idx];
   if(item){item.quantity+=delta;if(item.quantity<=0)demoMenuState.cart.splice(idx,1);main.innerHTML=renderFoodCardapio();}
   return;
  }
  if(e.target.closest('[data-demo-clear-tracker]')){demoMenuState.trackerOrder=null;main.innerHTML=renderFoodCardapio();return}
  if(e.target.closest('#demoMenuSubmit')){
   if(demoMenuState.busy)return;
   demoMenuState.busy=true;main.innerHTML=renderFoodCardapio();
   try{
    const payload={
     request_key:'demo_cardapio_'+crypto.randomUUID(),
     mode:demoMenuState.mode,
     table_number:demoMenuState.mode==='table'&&demoMenuState.tableNumber?Number(demoMenuState.tableNumber):null,
     customer_name:demoMenuState.customerName,
     customer_phone:demoMenuState.customerPhone,
     notes:demoMenuState.notes,
     payment_intent:demoMenuState.paymentIntent,
     change_for_cents:demoMenuState.paymentIntent==='cash'&&demoMenuState.changeFor.trim()?parseCents(demoMenuState.changeFor):null,
     delivery_address:demoMenuState.mode==='delivery'?{area_id:demoMenuState.areaId,street:demoMenuState.street,number:demoMenuState.number,complement:demoMenuState.complement,reference:demoMenuState.reference}:null,
     items:demoMenuState.cart.map(i=>({product_id:i.product_id,quantity:i.quantity,selections:i.selections||{},addons:i.addons||[],note:i.note||''}))
    };
    const res=await request('/api/online-orders',{method:'POST',body:JSON.stringify(payload)});
    demoMenuState.cart=[];
    demoMenuState.trackerOrder=res.order;
    toast('Solicitação #'+res.order.public_code+' enviada! Confira em Pedidos online.');
   }catch(err){
    toast(err.message);
   }finally{
    demoMenuState.busy=false;
    main.innerHTML=renderFoodCardapio();
   }
  }
 },true);

 document.addEventListener('input',e=>{
  if(e.target.id==='demoMenuSearch'){demoMenuState.search=e.target.value;main.innerHTML=renderFoodCardapio();const el=document.querySelector('#demoMenuSearch');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}}
  if(e.target.id==='demoMenuTable')demoMenuState.tableNumber=e.target.value;
  if(e.target.id==='demoMenuStreet')demoMenuState.street=e.target.value;
  if(e.target.id==='demoMenuNumber')demoMenuState.number=e.target.value;
  if(e.target.id==='demoMenuComplement')demoMenuState.complement=e.target.value;
  if(e.target.id==='demoMenuReference')demoMenuState.reference=e.target.value;
  if(e.target.id==='demoMenuName')demoMenuState.customerName=e.target.value;
  if(e.target.id==='demoMenuPhone')demoMenuState.customerPhone=e.target.value;
  if(e.target.id==='demoMenuChange')demoMenuState.changeFor=e.target.value;
  if(e.target.id==='demoMenuNotes')demoMenuState.notes=e.target.value;
 });
 document.addEventListener('change',e=>{
  if(e.target.id==='demoMenuArea'){demoMenuState.areaId=e.target.value;main.innerHTML=renderFoodCardapio();}
  if(e.target.id==='demoMenuPay'){demoMenuState.paymentIntent=e.target.value;main.innerHTML=renderFoodCardapio();}
 });
 window.addEventListener('hashchange',()=>{if(current==='cardapio')refreshDemoTracker();});
 window.IDSync?.on(scopes=>{if(!isRetail&&demoMenuState.trackerOrder&&(scopes.has('online')||scopes.has('orders')||scopes.has('returns')||scopes.has('settings')))refreshDemoTracker();});
 setInterval(()=>{if(current==='cardapio'&&!isRetail&&live.ready&&!document.hidden&&!document.querySelector('#dialog').open&&demoMenuState.trackerOrder)refreshDemoTracker();},5000);
 DemoRuntime.ready.then(()=>{
  applyAppearance();
  document.querySelector('#demoStatus').textContent=isRetail?'Pronto para experimentar · Varejo · 30 dias fictícios de vendas.':'Pronto para experimentar · Alimentação · Cardápio QR Code, retirada e delivery.';
 }).catch(()=>{});
})();
