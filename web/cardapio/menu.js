(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
  let products=[],category='',stopProducts=null,stopSettings=null,generation=0;
  function draw(){
    const search=$('search').value.trim().toLocaleLowerCase('pt-BR');
    $('products').innerHTML=products.filter(p=>(!category||p.category===category)&&(!search||(p.name+' '+p.description).toLocaleLowerCase('pt-BR').includes(search))).map(p=>`
      <article class="productcard ${p.available?'':'unavailable'}"><div class="photo">${p.imageDataUrl?`<img src="${esc(p.imageDataUrl)}" alt="${esc(p.name)}" loading="lazy">`:'◇'}</div>
      <div class="productbody"><small>${esc(p.category)}</small><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>
      ${(p.options||[]).map(o=>`<p>${esc(o.label)}: ${(o.values||[]).map(esc).join(' / ')}</p>`).join('')}
      ${(p.addons||[]).length?`<details><summary>Adicionais</summary>${p.addons.map(a=>`<p>${esc(a.name)} · + ${money(a.price_cents)}</p>`).join('')}</details>`:''}
      <div class="productbottom"><strong>${money(p.priceCents)}</strong><span>${p.available?'':'Esgotado'}</span></div></div></article>`).join('')||'<p>Nenhum produto encontrado neste filtro.</p>';
  }
  function categories(){
    const names=[...new Set(products.map(p=>p.category).filter(Boolean))];
    if(category&&!names.includes(category))category='';
    $('categories').replaceChildren();
    for(const name of ['',...names]){const button=document.createElement('button');button.className='btn';button.textContent=name||'Todos';button.setAttribute('aria-pressed',String(category===name));button.onclick=()=>{category=name;categories();draw();};$('categories').append(button);}
  }
  function stop(){generation++;stopProducts?.();stopSettings?.();stopProducts=null;stopSettings=null;}
  function failed(error){$('error').textContent='Não foi possível atualizar o catálogo. Verifique sua conexão e tente novamente.';console.warn('Catálogo público:',error?.code||'indisponível');}
  async function start(){
    if(document.hidden)return;
    stop();const g=generation;
    try{
      const fb=window.IDFirebase;if(!fb)throw Error('indisponível');
      const code=new URLSearchParams(location.search).get('empresa');
      if(!code?.trim())throw Error('Informe o código do estabelecimento.');
      const access=await fb.resolveBusinessAccess(code);
      if(g!==generation)return;
      if(!access?.active)throw Error('Estabelecimento não encontrado ou desativado.');
      const {doc,collection,query,where,onSnapshot}=fb.sdk;
      const id=access.businessId;
      stopSettings=onSnapshot(doc(fb.db,'businesses',id,'publicSettings','menu'),snap=>{
        if(g!==generation)return;
        if(!snap.exists()||!snap.data().active){products=[];draw();$('error').textContent='Catálogo indisponível no momento.';stopProducts?.();stopProducts=null;return;}
        const b=snap.data();$('name').textContent=b.name;document.title=b.name+' · Produtos';$('info').textContent=[b.address,b.phone].filter(Boolean).join(' · ');
        $('logo').hidden=!b.logoDataUrl;if(b.logoDataUrl)$('logo').src=b.logoDataUrl;
        if(/^#[a-f0-9]{6}$/i.test(b.themeColor||''))document.documentElement.style.setProperty('--green',b.themeColor);
        $('error').textContent='';
        if(!stopProducts)stopProducts=onSnapshot(query(collection(fb.db,'businesses',id,'publicProducts'),where('visible','==',true)),snapshot=>{
          if(g!==generation)return;
          products=snapshot.docs.map(d=>d.data()).sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'pt-BR')||a.name.localeCompare(b.name,'pt-BR'));
          $('error').textContent='';categories();draw();
        },failed);
      },failed);
    }catch(error){$('error').textContent=error.message?.startsWith('{')?'Não foi possível abrir o catálogo.':error.message;}
  }
  $('search').oninput=draw;
  document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
  window.addEventListener('pagehide',stop);
  start();
})();
