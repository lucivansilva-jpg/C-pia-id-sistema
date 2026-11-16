(()=>{
 const urlParams=new URLSearchParams(location.search);
 const isRetail=urlParams.get('kind')==='retail';
 const bar=document.querySelector('#demoBar');
 function measure(){document.documentElement.style.setProperty('--demo-height',Math.ceil(bar.getBoundingClientRect().height)+'px')}if('ResizeObserver' in window)new ResizeObserver(measure).observe(bar);else window.addEventListener('resize',measure);measure();

 function guide(){
  const d=document.querySelector('#dialog');if(d.open)d.close();
  d.innerHTML=isRetail
   ? `<div class="dialoghead"><h2>Conheça o ID Sistema — Varejo</h2><button class="btn" id="closeDemoGuide">Fechar</button></div><p>Você está na <strong>Vila Mix</strong>, uma loja de variedades fictícia com 10 produtos, estoque controlado e 30 dias de vendas no PDV.</p><div class="demo-guide">${[['inicio','1. Visão geral da loja','Acompanhe vendas, resultado estimado e indicadores da loja.'],['caixa','2. Venda direta no PDV','Experimente registrar uma venda no caixa. O caixa já está aberto.'],['produtos','3. Catálogo e estoque','Consulte produtos, códigos de barras e estoque por unidade.'],['relatorios','4. Relatórios e desempenho','Veja as vendas e o resultado financeiro.'],['financeiro','5. Gestão e financeiro','Explore contas a pagar, receber e despesas operacionais.'],['devolucoes','6. Trocas e devoluções','Simule devoluções e trocas de produtos vendidos.']].map(([route,title,text])=>`<a href="#${route}" data-demo-shortcut><strong>${title}</strong><small>${text}</small></a>`).join('')}</div><p class="demo-note">Demonstração pública de varejo. O botão Reiniciar exemplo restaura os dados.</p>`
   : `<div class="dialoghead"><h2>Conheça o ID Sistema</h2><button class="btn" id="closeDemoGuide">Fechar</button></div><p>Você está na <strong>Sabor da Vila</strong>, uma empresa fictícia com 10 produtos, 15 mesas e 30 dias de vendas. Os valores são exemplos calculados pelas regras do sistema.</p><div class="demo-guide">${[['inicio','1. Acompanhar o negócio','Veja vendas, custos, resultado estimado e alertas. Compare hoje, semana e mês.'],['caixa','2. Experimentar uma venda','Escolha produtos com fotos e receba um pagamento simulado. O caixa já está aberto.'],['pedidos','3. Atender uma comanda','As mesas 3 e 7 têm pedidos. Consulte, confira a impressão e leve ao caixa.'],['produtos','4. Conhecer os cadastros','Edite um preço, veja as fotos ou experimente importar produtos.'],['relatorios','5. Consultar o desempenho','Veja os produtos vendidos e a participação de João e Mateus.'],['financeiro','6. Explorar a gestão','Conheça contas, despesas, estoque e ficha técnica do hambúrguer.']].map(([route,title,text])=>`<a href="#${route}" data-demo-shortcut><strong>${title}</strong><small>${text}</small></a>`).join('')}</div><p class="demo-note">Use o seletor no topo para experimentar como proprietário, caixa ou garçom. O botão Reiniciar exemplo restaura tudo.</p>`;
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
 applyAccessUi=function(){access();for(const node of document.querySelectorAll('[data-menu-qr]'))node.hidden=true;applyAppearance()};

 menus.push(['ajuda','Ajuda e suporte']);icons.ajuda=icons.equipe;menuPermission.ajuda='profile.read';nav.insertAdjacentHTML('beforeend',`<a href="#ajuda" data-route="ajuda">${svg('ajuda')}Ajuda e suporte</a>`);
 const original=render;
 render=function(){
  original();
  if(current==='ajuda')main.innerHTML=heading('Ajuda e suporte','Exemplo da área de atendimento ao cliente.')+'<section class="panel settingsbody"><h2>Conversa com o suporte</h2><p>No sistema contratado, o proprietário pode abrir reclamações, informar erros ou enviar sugestões.</p><p class="demo-note">Nenhum chamado ou e-mail é enviado pela demonstração.</p><button class="btn" id="demoHelpGuide">Ver roteiro de demonstração</button></section>';
  applyAppearance();
 };

 const originalTeam=teamPage;
 teamPage=function(){return originalTeam()+'<p class="demo-note">Equipe fictícia. Alterar nomes e permissões aqui não cria logins reais.</p>'};

 printDocumentForOrder=async function(id,kind){const result=await request('/api/orders/'+id+'/print');showPrintPreview(buildReceiptHtml(result,kind));};
 const receipt=buildReceiptHtml;buildReceiptHtml=function(data,type){return receipt(data,type).replace('</body>','<p style="text-align:center;font-weight:bold">DEMONSTRAÇÃO · SEM VALOR COMERCIAL</p></body>')};

 document.addEventListener('click',e=>{if(e.target.closest('#demoHelpGuide'))guide()});
 DemoRuntime.ready.then(()=>{applyAppearance();document.querySelector('#demoStatus').textContent=isRetail?'Pronto para experimentar · Varejo · 30 dias fictícios de vendas.':'Pronto para experimentar · Alimentação · 30 dias fictícios de vendas.';}).catch(()=>{});
})();
