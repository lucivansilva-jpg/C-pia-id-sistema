// Focused integration trace: run server handlers, then replay their SQL in PostgreSQL under rollback.
import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import assert from 'node:assert/strict';
import {api,protectResponse} from '../backend/commerce/core.js';import {translate} from '../backend/erp/database.js';
const sql=new DatabaseSync(':memory:'),root='/workspace/sites/mesa-caixa';for(const n of fs.readdirSync(root+'/drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(root+'/drizzle/'+n,'utf8'));
// Generated DB defaults mirror the new tenant: initial settings and 15 tables.
sql.exec("INSERT INTO settings(id,name,updated_at) VALUES(1,'Teste isolado','2026-01-01'); INSERT OR IGNORE INTO dining_tables(id,number,seats,created_at) VALUES('initial',1,NULL,'2026-01-01')");
sql.exec("ALTER TABLE settings ADD COLUMN business_kind TEXT NOT NULL DEFAULT 'food';ALTER TABLE products ADD COLUMN barcode TEXT;CREATE UNIQUE INDEX product_barcode_unique ON products(barcode);ALTER TABLE products ADD COLUMN sale_unit TEXT DEFAULT 'un';ALTER TABLE products ADD COLUMN packaging TEXT DEFAULT '';ALTER TABLE products ADD COLUMN stock_mode TEXT DEFAULT 'none';ALTER TABLE products ADD COLUMN finished_inventory_id TEXT;CREATE TABLE customers(id TEXT PRIMARY KEY,name TEXT,phone TEXT,email TEXT,document TEXT,notes TEXT,active INTEGER,version INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT);ALTER TABLE orders ADD COLUMN customer_id TEXT;ALTER TABLE orders ADD COLUMN customer_name TEXT DEFAULT '';");
const batches=[],failedBatches=[];let recording=true;
function statement(query,args=[]){return {query,args,bind(...a){return statement(query,a)},async first(){if(recording)batches.push([{sql:translate(query,args),ignore:/INSERT OR IGNORE/i.test(query)}]);return sql.prepare(query).get(...args)||null},async all(){if(recording)batches.push([{sql:translate(query,args),ignore:/INSERT OR IGNORE/i.test(query)}]);return {results:sql.prepare(query).all(...args)}},async run(){if(recording)batches.push([{sql:translate(query,args),ignore:/INSERT OR IGNORE/i.test(query)}]);return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}}
}
const db={prepare:statement,async batch(stmts){const commands=stmts.map(s=>({sql:translate(s.query,s.args),ignore:/INSERT OR IGNORE/i.test(s.query)}));sql.exec('BEGIN');recording=false;try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');batches.push(commands);return r}catch(e){sql.exec('ROLLBACK');failedBatches.push(commands);throw e}finally{recording=true}}};
const admin={id:'isolated-admin',name:'Administrador',role:'admin'},waiter={id:'isolated-waiter',name:'Garçom',role:'waiter'},cashier={id:'isolated-cashier',name:'Caixa',role:'cashier'};let key=0;const requestKey=()=>('focused_test_'+ ++key).padEnd(25,'x');
async function call(path,method='GET',body,user=admin){const req=new Request('https://isolated.test'+path,{method,headers:{Origin:'https://isolated.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});try{const r=await protectResponse(user,await api(req,{DB:db,PRINCIPAL:user}));assert.ok(r.ok);return await r.json()}catch(e){e.message=path+': '+e.message;throw e}}

const baseProduct={name:'Refrigerante temporário',price_cents:1000,cost_cents:400,active:true,available:true,visible:true,barcode:'0789123456789',sale_unit:'lata',packaging:'350 ml',stock_mode:'unit',initial_stock:12,minimum_stock:2};
const p=await call('/api/products','POST',baseProduct);
let product=(await call('/api/products')).products.find(v=>v.id===p.id);assert.equal(product.stock_units,12);assert.equal(product.cost_cents,400);assert.equal(product.barcode,'0789123456789');
await assert.rejects(()=>call('/api/products','POST',baseProduct),e=>e.status===409);
const c=await call('/api/customers','POST',{name:'Cliente temporário',phone:'123',email:'',document:'',notes:'',active:true});
await assert.rejects(()=>call('/api/customers','GET',undefined,waiter),e=>e.status===403);
const session=requestKey();await call('/api/cash/open','POST',{request_key:session,opening_cents:1000},cashier);
const direct={request_key:requestKey(),session_id:session,method:'cash',tendered_cents:1000,expected_total_cents:950,discount_cents:50,discount_reason:'Cortesia autorizada',customer_id:c.id,items:[{product_id:p.id,quantity:1}]};
const sold=await call('/api/sales/direct','POST',direct,cashier);assert.equal(sold.change_cents,50);await call('/api/sales/direct','POST',direct,cashier);
assert.equal((await call('/api/products')).products[0].stock_units,11);assert.equal(sql.prepare('SELECT count(*) n FROM ledger').get().n,1);
const saved=(await call('/api/orders/'+sold.id)).order;assert.equal(saved.customer_name,'Cliente temporário');assert.equal(saved.discount_cents,50);assert.equal(saved.total_cents,950);
await assert.rejects(()=>call('/api/sales/direct','POST',{...direct,request_key:requestKey(),expected_total_cents:999000,tendered_cents:999000,discount_cents:0,items:[{product_id:p.id,quantity:999}]},cashier),e=>String(e.message).includes('stock_qty_nonzero'));
assert.equal(sql.prepare('SELECT count(*) n FROM ledger').get().n,1);assert.equal((await call('/api/products')).products[0].stock_units,11);
const order=await call('/api/orders','POST',{request_key:requestKey(),table_number:1,items:[{product_id:p.id,quantity:2}]},waiter);
assert.equal((await call('/api/products')).products[0].stock_units,9);
await assert.rejects(()=>call('/api/business-kind','PUT',{business_kind:'retail'}),e=>e.status===409);
await call('/api/orders/'+order.id+'/cancel','POST',{reason:'Cancelamento de teste'},cashier);
await call('/api/products/'+p.id+'/stock','POST',{request_key:requestKey(),kind:'entry',quantity:2,reason:'Retorno físico conferido'});
await call('/api/business-kind','PUT',{business_kind:'retail'});
assert.equal((await call('/api/tables')).tables.length,0);
await assert.rejects(()=>call('/api/orders','POST',{request_key:requestKey(),table_number:null,items:[{product_id:p.id,quantity:1}]},cashier),e=>e.status===409);
await assert.rejects(()=>call('/api/products','GET',undefined,waiter),e=>e.status===403);
const anonymous=await call('/api/sales/direct','POST',{...direct,request_key:requestKey(),discount_cents:0,discount_reason:'',customer_id:null,expected_total_cents:1000},cashier);assert.equal((await call('/api/orders/'+anonymous.id)).order.customer_id,null);
const customer=(await call('/api/customers')).customers[0];await call('/api/customers/'+c.id,'PUT',{...customer,name:'Nome atualizado',active:true});assert.equal((await call('/api/orders/'+sold.id)).order.customer_name,'Cliente temporário');assert.equal((await call('/api/customers/'+c.id+'/history')).orders.length,1);
product=(await call('/api/products')).products[0];await assert.rejects(()=>call('/api/products/'+p.id,'PUT',{...baseProduct,initial_stock:0,version:product.version-1}),e=>e.status===400||e.status===409);
const plain=await call('/api/products','POST',{...baseProduct,name:'Sem estoque',barcode:null,stock_mode:'none',initial_stock:0,cost_cents:null});await call('/api/sales/direct','POST',{...direct,request_key:requestKey(),discount_cents:0,discount_reason:'',customer_id:null,expected_total_cents:2000,tendered_cents:2000,items:[{product_id:plain.id,quantity:2}]},cashier);
await call('/api/business-kind','PUT',{business_kind:'food'});
// The existing deployed handler also consumes the compatible one-unit recipe for ready goods.
const {api:legacyApi}=await import('../backend/erp/core.js');const legacyRequest=new Request('https://isolated.test/api/sales/direct',{method:'POST',headers:{Origin:'https://isolated.test','Content-Type':'application/json'},body:JSON.stringify({...direct,request_key:requestKey(),discount_cents:0,discount_reason:'',customer_id:null,expected_total_cents:1000})});assert.equal((await legacyApi(legacyRequest,{DB:db,PRINCIPAL:cashier})).status,201);
assert.equal((await call('/api/products')).products.find(v=>v.id===p.id).stock_units,9);
fs.writeFileSync('/workspace/work/commerce-flow-trace.json',JSON.stringify({batches,failedBatches}));console.log('Conferido: código opcional/único, 12 unidades, venda com desconto e cliente, repetição sem duplicar, falta de estoque sem pagamento, comanda, estoque opcional, varejo e compatibilidade anterior.');
