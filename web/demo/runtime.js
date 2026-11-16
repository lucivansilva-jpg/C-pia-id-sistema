(()=>{
 'use strict';
 const nativeFetch=window.fetch.bind(window);window.DEMO_MODE=true;window.LOGIN_CONFIG={commerceEnabled:true,supabaseUrl:location.origin,apiUrl:'/demo/no-remote-api',publishableKey:''};
 const status=text=>{const el=document.querySelector('#demoStatus');if(el)el.textContent=text};
 function loadSql(){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-wasm.js';script.onload=()=>resolve(window.initSqlJs({locateFile:name=>'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/'+name}));script.onerror=()=>reject(Error('Não foi possível carregar a demonstração. Confira a conexão e recarregue a página.'));document.head.append(script)})}
 const ready=Promise.all([loadSql(),import('/demo/store.js'),nativeFetch('/demo/schema.sql').then(r=>{if(!r.ok)throw Error('Não foi possível preparar o exemplo.');return r.text()})]).then(async([SQL,module,schema])=>{const store=await module.createDemo(SQL,schema);window.ERP_ACCOUNT=await store.account();status('Pronto para experimentar · Nenhuma venda ou pagamento é real.');window.dispatchEvent(new Event('erp-account-ready'));return store});
 ready.catch(e=>status(e.message||'Falha ao abrir a demonstração. Recarregue para tentar novamente.'));
 window.DemoRuntime={ready,async setRole(role){const store=await ready;window.ERP_ACCOUNT=await store.setRole(role);return window.ERP_ACCOUNT},image(key){return this.store?.images.get(key)||'/demo/assets/logo.svg'}};ready.then(store=>window.DemoRuntime.store=store).catch(()=>{});
 const demoFetch=async function(input,options={}){const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href),method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  // Never forward ERP requests or credentials to production from the demonstration.
  if(/^\/(?:functions|rest|auth|storage)\/v1(?:\/|$)/.test(url.pathname))return Response.json({error:'Esta função utiliza apenas o ambiente real. A demonstração não se conecta a ele.'},{status:403});
  if(url.origin===location.origin&&(/^\/api\//.test(url.pathname)||/^\/media\//.test(url.pathname))){try{const store=await ready,headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));headers.set('Origin',url.origin);headers.delete('Authorization');headers.delete('apikey');return await store.handle(new Request(url,{...(input instanceof Request?{method:input.method,body:['GET','HEAD'].includes(input.method)?undefined:await input.clone().arrayBuffer()}:{}),...options,headers}))}catch{return Response.json({error:'Não foi possível iniciar a demonstração. Recarregue a página.'},{status:503})}}
  if(!['GET','HEAD'].includes(method))return Response.json({error:'A demonstração não envia dados a serviços externos.'},{status:403});return nativeFetch(input,options);
 };
 window.DemoRuntime.fetch=demoFetch;
 try{Object.defineProperty(window,'fetch',{value:demoFetch,writable:true,configurable:true})}catch{try{window.fetch=demoFetch}catch{}}
})();
