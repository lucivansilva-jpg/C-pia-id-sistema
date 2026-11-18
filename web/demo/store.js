// Public, browser-local demonstration. No credentials, tenants or remote database calls.
import {api,media,protectResponse,effectivePermissions} from './engine.js';
export const people=[{id:'demo-owner',name:'Ana · demonstração',username:'ana',role:'admin'},{id:'demo-cashier',name:'Bruno · demonstração',username:'bruno',role:'cashier'},{id:'demo-waiter',name:'João · demonstração',username:'joao',role:'waiter'},{id:'demo-waiter-2',name:'Mateus · demonstração',username:'mateus',role:'waiter'}];
export const catalog=[
 ['burger','Hambúrguer da Vila','Lanches',2200,950,'Pão, hambúrguer artesanal, queijo e salada.'],
 ['cheeseburger','Cheeseburger especial','Lanches',2600,1100,'Hambúrguer com queijo e molho da casa.'],
 ['sandwich','Misto quente','Lanches',1000,380,'Pão tostado com presunto e queijo.'],
 ['pizza','Pizza artesanal','Lanches',3500,1350,'Pizza de queijo e tomate. Foto ilustrativa.'],
 ['fries','Batata frita','Porções',1800,600,'Porção de batatas com tempero da casa.'],
 ['coffee','Cappuccino','Bebidas',900,280,'Café, leite cremoso e chocolate.'],
 ['latte','Café gelado','Bebidas',1200,350,'Café com leite servido com gelo.'],
 ['juice','Suco de laranja','Bebidas',1000,350,'Copo de 300 ml preparado na hora.'],
 ['soda','Refrigerante lata','Bebidas',600,300,'Lata de 350 ml. Estoque por unidade.'],
 ['cake','Bolo de chocolate — fatia','Doces',1200,420,'Fatia de bolo com cobertura. Foto ilustrativa.']
];

export const retailCatalog=[
 ['caderno','Caderno universitário 96 fls','Papelaria',1890,950,'Caderno espiral capa dura.'],
 ['caneta','Caneta esferográfica azul','Papelaria',350,160,'Escrita macia, ponta 1.0mm.'],
 ['garrafa','Garrafa térmica inox 500ml','Utilidades',4990,2400,'Mantém quente ou frio por 12h.'],
 ['pote','Pote organizador plástico','Utilidades',1450,680,'Pote transparente com tampa 1L.'],
 ['detergente','Detergente líquido 500ml','Limpeza',299,140,'Limpeza eficiente, neutro.'],
 ['esponja','Esponja de aço multiúso','Limpeza',320,150,'Pacote com 8 unidades.'],
 ['pilhas','Pilha alcalina AA c/ 4','Eletrônicos',1600,750,'Alta durabilidade e potência.'],
 ['cabo','Cabo USB reforçado 1m','Eletrônicos',2200,1000,'Revestimento em nylon trançado.'],
 ['copo','Copo acrílico resistente','Utilidades',650,300,'Copo 400ml para dia a dia.'],
 ['pano','Pano de limpeza microfibra','Limpeza',590,260,'Não solta fiapos, alta absorção.']
];

export const retailPeople=[{id:'demo-owner',name:'Ana · demonstração',username:'ana',role:'admin'},{id:'demo-cashier',name:'Bruno · demonstração',username:'bruno',role:'cashier'}];

function retailSvg(title,bg='#1e40af',fg='#ffffff'){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="${bg}"/><circle cx="150" cy="120" r="70" fill="#ffffff" opacity="0.15"/><text x="150" y="160" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="${fg}" text-anchor="middle">${title}</text></svg>`;
 return 'data:image/svg+xml;utf8,'+encodeURIComponent(svg);
}

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDay=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);

export async function createDemo(SQL,schema){
 const urlParams=new URLSearchParams(window.location.search);
 const isRetail=urlParams.get('kind')==='retail';
 const activePeople=isRetail?retailPeople:people;
 const activeCatalog=isRetail?retailCatalog:catalog;
 const businessName=isRetail?'Vila Mix — Loja de Variedades':'Sabor da Vila';
 const themeColor=isRetail?'#2563eb':'#a44924';
 const businessKind=isRetail?'retail':'food';

 const raw=new SQL.Database();raw.exec('PRAGMA foreign_keys=ON;');raw.exec(schema);const images=new Map(),objects=new Map();
 function execute(q,args=[]){const s=raw.prepare(q);try{s.bind(args.map(v=>v===undefined?null:v));const rows=[];while(s.step())rows.push(s.getAsObject());return rows}finally{s.free()}}
 function statement(query,args=[]){return {bind(...values){return statement(query,values)},async first(){return execute(query,args)[0]||null},async all(){return {results:execute(query,args)}},async run(){execute(query,args);return {meta:{changes:raw.getRowsModified()}}}}}
 const db={prepare:statement,async batch(list){raw.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());raw.exec('COMMIT');return out}catch(e){raw.exec('ROLLBACK');throw e}}};
 const bucket={async put(key,buffer,opt){const blob=new Blob([buffer],{type:opt.httpMetadata.contentType});objects.set(key,blob);images.set(key,URL.createObjectURL(blob))},async delete(key){const u=images.get(key);if(u?.startsWith('blob:'))URL.revokeObjectURL(u);objects.delete(key);images.delete(key)},async get(key){const b=objects.get(key);return b?{body:b,httpMetadata:{contentType:b.type}}:null}};
 let principal=activePeople[0];const env=()=>({DB:db,BUCKET:bucket,PRINCIPAL:principal});
 async function direct(path,method='GET',body,user=principal){const req=new Request('https://demo.invalid'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://demo.invalid'},body:body===undefined?undefined:JSON.stringify(body)});return await protectResponse(user,await api(req,{DB:db,BUCKET:bucket,PRINCIPAL:user}))}
 async function seedCall(path,method,body,user){const r=await direct(path,method,body,user);if(!r.ok)throw Error((await r.json()).error||'Falha ao preparar demonstração');return r.json()}
 const day=today(),stamp=new Date().toISOString();
 const modules=isRetail?{tables:false,finance:true,inventory:true,costs:true,online_orders:false,delivery:false}:{tables:true,finance:true,inventory:true,costs:true,online_orders:true,delivery:true};
 const deliveryAreas=isRetail?[]:[
  {id:'centro',name:'Centro',fee_cents:500,min_order_cents:1500,estimated_minutes:30,active:true},
  {id:'vila-nova',name:'Vila Nova',fee_cents:800,min_order_cents:2000,estimated_minutes:40,active:true},
  {id:'jardim-sul',name:'Jardim Sul',fee_cents:1200,min_order_cents:3000,estimated_minutes:50,active:true}
 ];
 execute('INSERT INTO settings(id,name,mode,paper,updated_at,receipt_message,address,phone,legal_name,theme_color,logo_key,business_kind,modules_json,online_orders_enabled,pickup_enabled,pickup_message,delivery_enabled,delivery_min_order_cents,delivery_default_minutes,delivery_areas_json) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
  businessName,
  'complete',
  80,
  stamp,
  isRetail?'Obrigado pela preferência! Volte sempre.':'Obrigado pela visita! Cupom de demonstração — sem valor fiscal.',
  isRetail?'Av. Central, 500 · Centro':'Rua Exemplo, 100 · Vila Fictícia',
  isRetail?'(11) 3333-4444':'',
  isRetail?'Vila Mix Comércio Ltda':'Sabor da Vila · empresa fictícia',
  themeColor,
  isRetail?'demo-logo-retail':'demo-logo',
  businessKind,
  JSON.stringify(modules),
  isRetail?0:1,
  isRetail?0:1,
  isRetail?'':'Retire no balcão informando o código do pedido.',
  isRetail?0:1,
  isRetail?0:1500,
  isRetail?45:40,
  JSON.stringify(deliveryAreas)
 ]);
 images.set(isRetail?'demo-logo-retail':'demo-logo',isRetail?retailSvg('Vila Mix','#2563eb'):'/demo/assets/logo.svg');
 for(const person of activePeople)execute('INSERT INTO employees(id,name,username,role,permissions,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)',[person.id,person.name,person.username,person.role,'{}',stamp,stamp]);
 
 const products=[];
 if(isRetail){
  for(const [asset,name,category,price,cost,description] of activeCatalog){
   const image=crypto.randomUUID();
   images.set(image,retailSvg(name.split(' ')[0], '#1e40af'));
   execute('INSERT INTO media(key,mime,size,created_by,created_at) VALUES(?,?,?,?,?)',[image,'image/svg+xml',0,activePeople[0].id,stamp]);
   const p=await seedCall('/api/products','POST',{
    name,category,
    price_cents:price,
    cost_cents:cost,
    description,
    image_key:image,
    stock_mode:'unit',
    initial_stock:60,
    minimum_stock:10,
    barcode:'7892000000'+String(products.length+1).padStart(3,'0'),
    sale_unit:'un',
    packaging:'unidade',
    active:true,available:true,visible:true,
    options:[],addons:[],quick_notes:['Frágil','Troca em 7 dias']
   });
   products.push({...p,asset,name,price_cents:price,cost_cents:cost,image_key:image});
  }
  const customers=[];for(const name of ['Marina Exemplo','Carlos Exemplo','Beatriz Exemplo']){const c=await seedCall('/api/customers','POST',{name,notes:'Cliente fictício da loja.',active:true});customers.push({...c,name});}
  for(let offset=-29;offset<=0;offset++){
   const date=addDay(day,offset),sid=crypto.randomUUID(),isCurrent=offset===0,opened=date+'T09:00:00.000Z';
   execute("INSERT INTO cash_sessions(id,state,opening_cents,actor_id,opened_at) VALUES(?,'open',30000,?,?)",[sid,activePeople[1].id,opened]);
   let cashSales=0;const count=10+((offset+30)%5);
   for(let n=0;n<count;n++){
    const actor=activePeople[n%activePeople.length],p=products[(n+offset+30)%products.length],q=1+(n%3===0?1:0);
    const items=[{id:crypto.randomUUID(),product_id:p.id,product_code:String(products.indexOf(p)+1).padStart(6,'0'),name:p.name,quantity:q,base_unit_price_cents:p.price_cents,unit_price_cents:p.price_cents,unit_cost_cents:p.cost_cents,inventory_unit_cost_cents:p.cost_cents,stock_mode:'unit',finished_inventory_id:execute('SELECT finished_inventory_id id FROM products WHERE id=?',[p.id])[0].id,addons:[],selections:{},note:'',actor_id:actor.id,actor_name:actor.name}];
    const total=items.reduce((a,i)=>a+i.quantity*i.unit_price_cents,0),id=crypto.randomUUID(),method=['cash','pix','credit','debit'][n%4],when=date+'T'+String(10+Math.floor(n/2)).padStart(2,'0')+':'+String((n%2)*20).padStart(2,'0')+':00.000Z',c=n%4===0?customers[n%customers.length]:null;
    execute("INSERT INTO orders(id,request_key,state,fulfillment,items,total_cents,actor_id,attendant_name,created_at,updated_at,closed_at,discount_cents,discount_reason,customer_id,customer_name) VALUES(?,?,'closed','delivered',?,?,?,?,?,?,?,?,?,?,?)",[id,crypto.randomUUID(),JSON.stringify(items),total,actor.id,actor.name,when,when,when,0,'',c?.id||null,c?.name||'']);
    execute("INSERT INTO ledger(id,request_key,session_id,order_id,kind,method,amount_cents,tendered_cents,description,actor_id,created_at,finance_account) VALUES(?,?,?,?,'sale',?,?,?,'Venda direta no caixa',?,?,?)",[crypto.randomUUID(),crypto.randomUUID(),sid,id,method,total,total,activePeople[1].id,when,method==='cash'?'drawer':'bank']);
    if(method==='cash')cashSales+=total;
    const invId=execute('SELECT finished_inventory_id id FROM products WHERE id=?',[p.id])[0].id;
    execute("INSERT INTO inventory_moves(id,request_key,item_id,quantity_milli,kind,source_id,reason,actor_id,created_at) VALUES(?,?,?,?,'sale',?,'Venda no PDV',?,?)",[crypto.randomUUID(),crypto.randomUUID(),invId,-q*1000,id,activePeople[1].id,when]);
   }
   const expense=2000+((offset+30)%4)*800;
   execute("INSERT INTO ledger(id,request_key,session_id,kind,method,amount_cents,description,actor_id,created_at,category,finance_account) VALUES(?,?,?,'expense','cash',?,'Despesa operacional fictícia',?,?,'Operação','drawer')",[crypto.randomUUID(),crypto.randomUUID(),sid,-expense,activePeople[1].id,date+'T18:00:00.000Z']);
   if(!isCurrent)execute("UPDATE cash_sessions SET state='closed',closed_at=?,counted_cents=?,expected_cents=?,difference_cents=0 WHERE id=?",[date+'T22:00:00.000Z',30000+cashSales-expense,30000+cashSales-expense,sid]);
  }
  for(const p of [products[0],products[2],products[4]])await seedCall('/api/favorites','PUT',{product_id:p.id,favorite:true});
  for(const title of ['Cliente João — Orçamento', 'Cliente Ana — Separação'])await seedCall('/api/drafts','POST',{request_key:crypto.randomUUID(),title,items:[{product_id:products[0].id,quantity:1},{product_id:products[2].id,quantity:1}]});
  execute('INSERT INTO suppliers(id,name,phone,notes,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',['demo-supplier','Distribuidora Vila Mix','','Fornecedor fictício da loja',stamp,stamp]);
 } else {
  for(const [asset,name,category,price,cost,description] of catalog){
   const image=crypto.randomUUID();
   images.set(image,'/demo/assets/'+asset+'.jpg');
   execute('INSERT INTO media(key,mime,size,created_by,created_at) VALUES(?,?,?,?,?)',[image,'image/jpeg',0,people[0].id,stamp]);
   const p=await seedCall('/api/products','POST',{name,category,price_cents:price,cost_cents:cost,description,image_key:image,stock_mode:asset==='soda'?'unit':'none',initial_stock:0,minimum_stock:asset==='soda'?12:0,barcode:asset==='soda'?'7890000000001':null,sale_unit:asset==='soda'?'lata':'un',packaging:asset==='soda'?'350 ml':'',active:true,available:true,visible:true,options:asset==='juice'?[{label:'Açúcar',required:false,values:['Sem açúcar','Com açúcar']}]:[],addons:asset==='burger'?[{name:'Bacon crocante',price_cents:400,cost_cents:150},{name:'Queijo extra',price_cents:300,cost_cents:100}]:[],quick_notes:['Sem cebola','Para viagem']});
   products.push({...p,asset,name,price_cents:price,cost_cents:cost,image_key:image});
  }
  for(let n=1;n<=15;n++)await seedCall('/api/tables','POST',{number:n,seats:4});
  const ingredients=[['demo-bread','Pão de hambúrguer','un',200000000,5000,60000],['demo-meat','Carne para hambúrguer','kg',4000000000,2000,10000],['demo-cheese','Queijo','kg',3000000000,1000,4000]];
  for(const [id,name,unit,cost,min] of ingredients)execute('INSERT INTO inventory_items(id,name,unit,minimum_milli,unit_cost_micro,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)',[id,name,unit,min,cost,stamp,stamp]);
  for(const [id,qty] of [['demo-bread',1000],['demo-meat',150],['demo-cheese',50]])execute('INSERT INTO recipes(product_id,item_id,quantity_milli) VALUES(?,?,?)',[products[0].id,id,qty]);execute("UPDATE products SET cost_mode='recipe',stock_mode='recipe',track_stock=1 WHERE id=?",[products[0].id]);
  const customers=[];for(const name of ['Marina Exemplo','Carlos Exemplo','Beatriz Exemplo']){const c=await seedCall('/api/customers','POST',{name,notes:'Cadastro fictício para apresentação.',active:true});customers.push({...c,name});}
  const used=new Map();const stockUse=(p,q,source,date)=>{const needs=p.asset==='burger'?[['demo-bread',1000*q],['demo-meat',150*q],['demo-cheese',50*q]]:p.asset==='soda'?[[execute('SELECT finished_inventory_id id FROM products WHERE id=?',[p.id])[0].id,1000*q]]:[];for(const [item,qty] of needs){used.set(item,(used.get(item)||0)+qty);execute("INSERT INTO inventory_moves(id,request_key,item_id,quantity_milli,kind,source_id,reason,actor_id,created_at) VALUES(?,?,?,?,'sale',?,'Venda fictícia',?,?)",[crypto.randomUUID(),crypto.randomUUID(),item,-qty,source,people[1].id,date]);}};
  for(let offset=-29;offset<=0;offset++){const date=addDay(day,offset),sid=crypto.randomUUID(),isCurrent=offset===0,opened=date+'T10:00:00.000Z';execute("INSERT INTO cash_sessions(id,state,opening_cents,actor_id,opened_at) VALUES(?,'open',20000,?,?)",[sid,people[1].id,opened]);let cashSales=0;const count=8+((offset+30)%6);
   for(let n=0;n<count;n++){const actor=people[2+(n%2)],p=products[(n+offset+30)%products.length],q=1+(n%3===0?1:0),second=products[(n+4)%products.length],chosen=[{p,q}];if(n%2===0&&second.id!==p.id)chosen.push({p:second,q:1});const items=chosen.map(({p,q})=>({id:crypto.randomUUID(),product_id:p.id,product_code:String(products.indexOf(p)+1).padStart(6,'0'),name:p.name,quantity:q,base_unit_price_cents:p.price_cents,unit_price_cents:p.price_cents,unit_cost_cents:p.cost_cents,inventory_unit_cost_cents:p.cost_cents,stock_mode:p.asset==='soda'?'unit':p.asset==='burger'?'recipe':'none',finished_inventory_id:p.asset==='soda'?execute('SELECT finished_inventory_id id FROM products WHERE id=?',[p.id])[0].id:null,addons:[],selections:{},note:'',actor_id:actor.id,actor_name:actor.name}));const gross=items.reduce((a,i)=>a+i.quantity*i.unit_price_cents,0),discount=n%7===0?100:0,total=gross-discount,id=crypto.randomUUID(),method=['cash','pix','credit','debit'][n%4],when=date+'T'+String(12+Math.floor(n/2)).padStart(2,'0')+':'+String((n%2)*20).padStart(2,'0')+':00.000Z',c=n%5===0?customers[n%customers.length]:null;
    execute("INSERT INTO orders(id,request_key,state,fulfillment,items,total_cents,actor_id,attendant_name,created_at,updated_at,closed_at,discount_cents,discount_reason,customer_id,customer_name) VALUES(?,?,'closed','delivered',?,?,?,?,?,?,?,?,?,?,?)",[id,crypto.randomUUID(),JSON.stringify(items),total,actor.id,actor.name,when,when,when,discount,discount?'Cortesia de demonstração':'',c?.id||null,c?.name||'']);execute("INSERT INTO ledger(id,request_key,session_id,order_id,kind,method,amount_cents,tendered_cents,description,actor_id,created_at,finance_account) VALUES(?,?,?,?,'sale',?,?,?,'Venda fictícia',?,?,?)",[crypto.randomUUID(),crypto.randomUUID(),sid,id,method,total,total,people[1].id,when,method==='cash'?'drawer':'bank']);if(method==='cash')cashSales+=total;for(const line of chosen)stockUse(line.p,line.q,id,when);
   }
   const expense=1500+((offset+30)%4)*500;execute("INSERT INTO ledger(id,request_key,session_id,kind,method,amount_cents,description,actor_id,created_at,category,finance_account) VALUES(?,?,?,'expense','cash',?,'Despesa operacional fictícia',?,?,'Operação','drawer')",[crypto.randomUUID(),crypto.randomUUID(),sid,-expense,people[1].id,date+'T18:00:00.000Z']);if(!isCurrent)execute("UPDATE cash_sessions SET state='closed',closed_at=?,counted_cents=?,expected_cents=?,difference_cents=0 WHERE id=?",[date+'T23:00:00.000Z',20000+cashSales-expense,20000+cashSales-expense,sid]);
  }
  const soda=execute('SELECT finished_inventory_id id FROM products WHERE id=?',[products[8].id])[0].id;for(const [id,base] of [...ingredients.map(([id,,,,,qty])=>[id,qty]),[soda,6000]])execute("INSERT INTO inventory_moves(id,request_key,item_id,quantity_milli,kind,reason,actor_id,created_at) VALUES(?,?,?,?,'entry','Saldo inicial fictício',?,?)",[crypto.randomUUID(),crypto.randomUUID(),id,base+(used.get(id)||0),people[0].id,addDay(day,-30)+'T09:00:00.000Z']);
  execute('INSERT INTO suppliers(id,name,phone,notes,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',['demo-supplier','Distribuidora Exemplo','','Fornecedor fictício',stamp,stamp]);
  for(const [number,actor,items] of [[3,people[2],[{product_id:products[0].id,quantity:2},{product_id:products[8].id,quantity:1}]],[7,people[3],[{product_id:products[2].id,quantity:2},{product_id:products[7].id,quantity:2}]]])await seedCall('/api/orders','POST',{request_key:crypto.randomUUID(),table_number:number,items},actor);
  await seedCall('/api/online-orders','POST',{
   request_key:'demo-seed-online-delivery-1',
   mode:'delivery',
   customer_name:'Camila Ferreira',
   customer_phone:'(11) 98888-1122',
   notes:'Tocar o interfone 12.',
   payment_intent:'cash',
   change_for_cents:5000,
   delivery_address:{area_id:'centro',street:'Rua das Flores',number:'240',complement:'Ap 12',reference:'Próximo à praça'},
   items:[{product_id:products[0].id,quantity:1,note:'Sem cebola'},{product_id:products[4].id,quantity:1}]
  });
  await seedCall('/api/online-orders','POST',{
   request_key:'demo-seed-online-pickup-2',
   mode:'pickup',
   customer_name:'Lucas Oliveira',
   customer_phone:'(11) 97777-3344',
   notes:'Retiro em 15 minutos.',
   payment_intent:'pix',
   items:[{product_id:products[1].id,quantity:1},{product_id:products[7].id,quantity:1,selections:{'Açúcar':'Sem açúcar'}}]
  });
  for(const p of [products[0],products[5],products[7]])await seedCall('/api/favorites','PUT',{product_id:p.id,favorite:true});
 }

 for(const [kind,title,amount,due,category] of [['payable','Conta de energia · exemplo',18000,-2,'Energia'],['payable','Fornecedor · exemplo',45000,3,'Mercadorias'],['receivable','Encomenda · exemplo',15000,5,'Encomendas']])execute("INSERT INTO accounts(id,request_key,kind,title,amount_cents,due_date,state,actor_id,created_at,category) VALUES(?,?,?,?,?,?,'pending',?,?,?)",[crypto.randomUUID(),crypto.randomUUID(),kind,title,amount,addDay(day,due),activePeople[0].id,stamp,category]);

 function decorate(v){if(Array.isArray(v))return v.map(decorate);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,typeof x==='string'&&x.startsWith('/media/')?images.get(x.slice(7))||'/demo/assets/logo.svg':decorate(x)]));return v}
 let queue=Promise.resolve();async function handle(req){const run=async()=>{try{const path=new URL(req.url).pathname;
   if(path==='/api/appearance'){if(principal.role!=='admin')return Response.json({error:'Somente o proprietário altera a identidade.'},{status:403});if(req.method==='GET')return Response.json(execute('SELECT logo_key,theme_color FROM settings WHERE id=1')[0]);const b=await req.json();if(!/^#[a-f0-9]{6}$/i.test(b.theme_color)||(b.logo_key!==null&&!images.has(b.logo_key)))return Response.json({error:'Confira a cor e a imagem.'},{status:400});execute('UPDATE settings SET logo_key=?,theme_color=? WHERE id=1',[b.logo_key,b.theme_color]);return Response.json({ok:true})}
   const r=path==='/api/media'||path.startsWith('/media/')?await media(req,env()):await protectResponse(principal,await api(req,env()));if(r.headers.get('Content-Type')?.includes('application/json'))return Response.json(decorate(await r.json()),{status:r.status});return r;
  }catch(e){return Response.json({error:e.status?e.message:String(e.message).includes('stock_qty_nonzero')?'Estoque insuficiente para esta simulação.':'Não foi possível concluir a simulação. Reinicie o exemplo se necessário.'},{status:e.status||409})}};const next=queue.then(run,run);queue=next.then(()=>{});return next}
 return {handle,images,day,async account(){const r=await direct('/api/session');const {user}=await r.json();return {business:{id:'demo-local',code:'demonstracao',name:execute('SELECT name FROM settings WHERE id=1')[0].name,business_kind:businessKind,modules},user,platform:false,support:null,demo:true}},async setRole(role){const selected=activePeople.find(p=>p.role===role);if(!selected)throw Error('Perfil inválido');principal=selected;return this.account()},close(){for(const url of images.values())if(url.startsWith('blob:'))URL.revokeObjectURL(url);raw.close()}};
}
