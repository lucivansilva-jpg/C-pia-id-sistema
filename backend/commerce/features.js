const SALE_UNITS=['un','pct','lata','garrafa','frasco','pote','par'];
async function customerForSale(db,user,id){if(!id)return null;assertPermission(user,'cash.access');const row=await stmt(db,'SELECT id,name FROM customers WHERE id=? AND active=1',id).first();if(!row)fail(400,'Cliente não encontrado ou inativo.');return row}
async function commerceProductApi(req,env,user,path){if(!((path==='/api/products'&&req.method==='POST')||(/^\/api\/products\/[^/]+$/.test(path)&&req.method==='PUT')))return null;
 assertPermission(user,'products.manage');const b=await body(req),db=env.DB,creating=req.method==='POST',id=creating?crypto.randomUUID():path.split('/').pop(),old=creating?null:await stmt(db,'SELECT * FROM products WHERE id=?',id).first();
 let importFingerprint=null;if(b.import_key!==undefined){if(typeof b.import_key!=='string'||!/^[-a-f0-9]{36}:[0-9]{1,4}$/i.test(b.import_key))fail(400,'Identificador de importação inválido.');importFingerprint=await digestInput(b);const saved=await stmt(db,'SELECT fingerprint,actor_id,product_id FROM product_import_rows WHERE request_key=?',b.import_key).first();if(saved){if(saved.actor_id!==user.id||saved.fingerprint!==importFingerprint)fail(409,'Esta linha já foi processada com outros dados. Atualize o catálogo e confira.');return json({ok:true,id:saved.product_id,replayed:true})}}
 if(!creating&&!old)fail(404,'Produto não encontrado.');if(!creating&&!num(b.version,1,1e9))fail(400,'Versão inválida.');
 const name=clean(b.name,100),barcode=clean(b.barcode,65)||null,unit=b.sale_unit??old?.sale_unit??'un',mode=b.stock_mode??old?.stock_mode??'none';
 if(!name||!num(b.price_cents,0,100000000)||!SALE_UNITS.includes(unit)||!['none','unit','recipe'].includes(mode)||(barcode&&!/^[A-Za-z0-9._/-]{1,64}$/.test(barcode)))fail(400,'Confira nome, preço, unidade e código de barras.');
 if(barcode){const duplicate=await stmt(db,'SELECT id FROM products WHERE barcode=?',barcode).first();if(duplicate&&duplicate.id!==id)fail(409,'O código de barras já pertence a outro produto.');}
 const initial=b.initial_stock??0,minimum=b.minimum_stock??0;if(!num(initial,0,1000000)||!num(minimum,0,1000000))fail(400,'Informe quantidades inteiras de unidades.');if(initial&&(!creating||mode!=='unit'))fail(400,'Saldo inicial somente para novo produto por unidade.');if(initial)assertPermission(user,'reports.view');
 const flags=['active','available','visible'].map(k=>{if(typeof b[k]!=='boolean')fail(400,'Opção inválida.');return b[k]?1:0});
 const image=clean(b.image_key,100)||null;if(image&&!await stmt(db,'SELECT key FROM media WHERE key=?',image).first())fail(400,'Foto não encontrada.');
 const costPermission=hasPermission(user,'products.costs');if(costPermission&&!(b.cost_cents===null||num(b.cost_cents,0,100000000)))fail(400,'Custo inválido.');const cost=costPermission?b.cost_cents:old?.cost_cents??null;
 let rawAddons=b.addons??JSON.parse(old?.addons_json||'[]');if(!costPermission){const prior=JSON.parse(old?.addons_json||'[]');rawAddons=rawAddons.map(a=>({...a,cost_cents:prior.find(v=>v.name===a.name)?.cost_cents??null}))}
 const options=normalizeOptions(b.options??JSON.parse(old?.options_json||'[]')),addons=normalizeAddons(rawAddons),quick=(b.quick_notes??JSON.parse(old?.quick_notes_json||'[]'));if(!Array.isArray(quick))fail(400,'Observações inválidas.');
 let itemId=old?.finished_inventory_id||null;if(mode==='unit'&&!itemId)itemId=crypto.randomUUID();
 const changedMode=old&&old.stock_mode!==mode,recipe=(await stmt(db,'SELECT item_id,quantity_milli FROM recipes WHERE product_id=?',id).all()).results;
 const track=mode==='unit'?1:mode==='recipe'&&old?.stock_mode!=='unit'&&recipe.length?1:0,costMode=mode==='unit'?'recipe':old?.stock_mode==='unit'?'direct':old?.cost_mode||'direct';
 const time=now(),marker=crypto.randomUUID(),guard='EXISTS(SELECT 1 FROM audit_log WHERE id=?)',statements=[];
 // Inventory is inserted before the product so its foreign key is already satisfied; the batch rolls back on any failure.
 if(mode==='unit'){
  const current=itemId?await stmt(db,'SELECT unit_cost_micro FROM inventory_items WHERE id=?',itemId).first():null;
  const micro=costPermission?(cost===null?null:cost*1000000):current?.unit_cost_micro??null;
  statements.push(stmt(db,'INSERT INTO inventory_items(id,name,unit,minimum_milli,unit_cost_micro,active,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE ?=1 OR EXISTS(SELECT 1 FROM products WHERE id=? AND version=?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,minimum_milli=excluded.minimum_milli,unit_cost_micro=excluded.unit_cost_micro,active=1,updated_at=excluded.updated_at',itemId,name,'un',minimum*1000,micro,time,time,creating?1:0,id,b.version||null));
 }
 const values=[name,clean(b.description,500),clean(b.category,60),b.price_cents,cost,image,...flags,JSON.stringify(options),JSON.stringify(addons),JSON.stringify(quick.slice(0,20).map(n=>clean(n,80)).filter(Boolean)),barcode,unit,clean(b.packaging,80),mode,itemId,track,costMode];
 const mutationIndex=statements.length;
 if(creating)statements.push(stmt(db,'INSERT INTO products(id,code,name,description,category,price_cents,cost_cents,image_key,active,available,visible,options_json,addons_json,quick_notes_json,barcode,sale_unit,packaging,stock_mode,finished_inventory_id,track_stock,cost_mode,created_at,updated_at) VALUES(?,(SELECT COALESCE(MAX(code),0)+1 FROM products),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,...values,time,time));
 else statements.push(stmt(db,'UPDATE products SET name=?,description=?,category=?,price_cents=?,cost_cents=?,image_key=?,active=?,available=?,visible=?,options_json=?,addons_json=?,quick_notes_json=?,barcode=?,sale_unit=?,packaging=?,stock_mode=?,finished_inventory_id=?,track_stock=?,cost_mode=?,version=version+1,updated_at=? WHERE id=? AND version=?',...values,time,id,b.version));
 statements.push(stmt(db,"INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT ?,?,?,?,? WHERE changes()=1",marker,user.id,creating?'product.create':'product.update',id,time));
 if(mode==='unit'){
  statements.push(stmt(db,'DELETE FROM recipes WHERE product_id=? AND '+guard,id,marker),stmt(db,'INSERT INTO recipes(product_id,item_id,quantity_milli) SELECT ?,?,1000 WHERE '+guard,id,itemId,marker));
  if(initial)statements.push(stmt(db,"INSERT INTO inventory_moves(id,request_key,item_id,quantity_milli,kind,reason,actor_id,created_at) SELECT ?,?,?,?,'entry','Saldo inicial de mercadoria',?,? WHERE "+guard,crypto.randomUUID(),'opening:'+id,itemId,initial*1000,user.id,time,marker));
 }else if(changedMode&&old.stock_mode==='unit')statements.push(stmt(db,'DELETE FROM recipes WHERE product_id=? AND item_id=? AND '+guard,id,old.finished_inventory_id,marker));
 // Reject stale updates before the batch so inventory metadata is not touched by an obsolete editor.
 if(old&&old.version!==b.version)fail(409,'O produto mudou. Reabra o cadastro.');
 if(b.import_key)statements.push(stmt(db,'INSERT INTO product_import_rows(request_key,fingerprint,actor_id,product_id,created_at) SELECT ?,?,?,?,? WHERE '+guard,b.import_key,importFingerprint,user.id,id,time,marker));
 const result=await db.batch(statements);if(!result[mutationIndex].meta.changes)fail(409,'O produto mudou. Reabra o cadastro.');return json({ok:true,id},creating?201:200);
}
async function commerceApi(req,env,user,path){const extra=await extendedCommerceApi(req,env,user,path);if(extra)return extra;const db=env.DB;const history=path.match(/^\/api\/customers\/([^/]+)\/history$/);if(history&&req.method==='GET'){assertPermission(user,'cash.access');return json({orders:(await stmt(db,'SELECT id,number,state,total_cents,created_at,closed_at,customer_name FROM orders WHERE customer_id=? ORDER BY number DESC LIMIT 100',history[1]).all()).results})}
 if(path==='/api/business-kind'){
  assertPermission(user,req.method==='GET'?'settings.read':'settings.manage');if(req.method==='GET')return json(await db.prepare('SELECT business_kind FROM settings WHERE id=1').first());
  if(req.method!=='PUT')fail(405,'Método não permitido.');const b=await body(req);if(!['food','retail'].includes(b.business_kind))fail(400,'Modalidade inválida.');
  if(b.business_kind==='retail'&&await db.prepare("SELECT id FROM orders WHERE state='open' OR (state!='cancelled' AND fulfillment!='delivered') LIMIT 1").first())fail(409,'Finalize e entregue as comandas pendentes antes de mudar para varejo.');
  await db.batch([stmt(db,'UPDATE settings SET business_kind=?,updated_at=? WHERE id=1',b.business_kind,now()),audit(db,user,'business.kind.update','1')]);return json({ok:true});
 }
 if(path==='/api/customers'||/^\/api\/customers\/[^/]+$/.test(path)){
  assertPermission(user,'cash.access');
  if(path==='/api/customers'&&req.method==='GET')return json({customers:(await db.prepare('SELECT * FROM customers ORDER BY active DESC,name LIMIT 500').all()).results});
  assertPermission(user,'payments.receive');if(!['POST','PUT'].includes(req.method))fail(405,'Método não permitido.');const b=await body(req),id=req.method==='POST'?crypto.randomUUID():path.split('/').pop(),name=clean(b.name,100),document=clean(b.document,30).replace(/\D/g,''),email=clean(b.email,120);
  if(!name||(document&&![11,14].includes(document.length))||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||(req.method==='PUT'&&(!num(b.version,1,1e9)||typeof b.active!=='boolean')))fail(400,'Confira nome, contato e CPF/CNPJ opcional.');
  const values=[name,clean(b.phone,30),email,document,clean(b.notes,500),b.active===false?0:1],time=now();
  if(req.method==='POST')await db.batch([stmt(db,'INSERT INTO customers(id,name,phone,email,document,notes,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,...values,time,time),audit(db,user,'customer.create',id)]);
  else {const result=await db.batch([stmt(db,'UPDATE customers SET name=?,phone=?,email=?,document=?,notes=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?',...values,time,id,b.version),stmt(db,"INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT ?,?,'customer.update',?,? WHERE changes()=1",crypto.randomUUID(),user.id,id,time)]);if(!result[0].meta.changes)fail(409,'O cliente mudou. Atualize o cadastro.');}return json({ok:true,id},req.method==='POST'?201:200);
 }
 const stock=path.match(/^\/api\/products\/([^/]+)\/stock$/);if(stock&&req.method==='POST'){
  assertPermission(user,'reports.view');const p=await stmt(db,'SELECT finished_inventory_id,stock_mode FROM products WHERE id=?',stock[1]).first();if(p?.stock_mode!=='unit')fail(400,'Produto sem estoque por unidade.');const b=await body(req);if(!num(b.quantity,0,1000000))fail(400,'Informe a quantidade inteira de unidades.');
  const logical=new Request(new URL('/api/erp/inventory/'+p.finished_inventory_id+'/movement',req.url),{method:'POST',headers:req.headers,body:JSON.stringify({request_key:b.request_key,kind:b.kind,quantity_milli:b.quantity*1000,reason:b.reason})});return await erpApi(logical,env,user,new URL(logical.url).pathname);
 }
 const customer=path.match(/^\/api\/orders\/([^/]+)\/customer$/);if(customer&&req.method==='POST'){
  assertPermission(user,'payments.receive');const b=await body(req),c=await customerForSale(db,user,b.customer_id),time=now();const result=await db.batch([stmt(db,"UPDATE orders SET customer_id=?,customer_name=?,version=version+1,updated_at=? WHERE id=? AND state='open' AND version=?",c?.id||null,c?.name||'',time,customer[1],b.version),stmt(db,"INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT ?,?,'order.customer.update',?,? WHERE changes()=1",crypto.randomUUID(),user.id,customer[1],time)]);if(!result[0].meta.changes)fail(409,'A comanda mudou ou já foi finalizada. Atualize a tela.');return json({ok:true});
 }
 return null;
}
