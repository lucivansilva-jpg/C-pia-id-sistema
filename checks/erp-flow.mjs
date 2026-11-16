// Focused integration trace: run server handlers, then replay their SQL in PostgreSQL under rollback.
import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import assert from 'node:assert/strict';
import {api,protectResponse} from '../backend/erp/core.js';import {translate} from '../backend/erp/database.js';
const sql=new DatabaseSync(':memory:'),root='/workspace/sites/mesa-caixa';for(const n of fs.readdirSync(root+'/drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(root+'/drizzle/'+n,'utf8'));
// Generated DB defaults mirror the new tenant: initial settings and 15 tables.
sql.exec("INSERT INTO settings(id,name,updated_at) VALUES(1,'Teste isolado','2026-01-01'); INSERT OR IGNORE INTO dining_tables(id,number,seats,created_at) VALUES('initial',1,NULL,'2026-01-01')");
const batches=[];let recording=true;
function statement(query,args=[]){return {query,args,bind(...a){return statement(query,a)},async first(){if(recording)batches.push([{sql:translate(query,args),ignore:/INSERT OR IGNORE/i.test(query)}]);return sql.prepare(query).get(...args)||null},async all(){if(recording)batches.push([{sql:translate(query,args),ignore:/INSERT OR IGNORE/i.test(query)}]);return {results:sql.prepare(query).all(...args)}},async run(){if(recording)batches.push([{sql:translate(query,args),ignore:/INSERT OR IGNORE/i.test(query)}]);return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}}
}
const db={prepare:statement,async batch(stmts){batches.push(stmts.map(s=>({sql:translate(s.query,s.args),ignore:/INSERT OR IGNORE/i.test(s.query)})));sql.exec('BEGIN');recording=false;try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}finally{recording=true}}};
const admin={id:'isolated-admin',name:'Administrador',role:'admin'},waiter={id:'isolated-waiter',name:'Garçom',role:'waiter'},cashier={id:'isolated-cashier',name:'Caixa',role:'cashier'};let key=0;const requestKey=()=>('focused_test_'+ ++key).padEnd(25,'x');
async function call(path,method='GET',body,user=admin){const req=new Request('https://isolated.test'+path,{method,headers:{Origin:'https://isolated.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});try{const r=await protectResponse(user,await api(req,{DB:db,PRINCIPAL:user}));assert.ok(r.ok);return await r.json()}catch(e){e.message=path+': '+e.message;throw e}}
const p=await call('/api/products','POST',{name:'Verificação temporária',price_cents:1500,cost_cents:500,active:true,available:true,visible:true});
const cashKey=requestKey();await call('/api/cash/open','POST',{request_key:cashKey,opening_cents:10000},cashier);
const o=await call('/api/orders','POST',{request_key:requestKey(),table_number:1,items:[{product_id:p.id,quantity:2}]},waiter);
assert.equal((await call('/api/orders/'+o.id+'/print')).order.total_cents,3000);
for(const path of ['/api/cash','/api/orders/'+o.id+'/print'])await assert.rejects(()=>call(path,'GET',undefined,waiter),e=>e.status===403);
await call('/api/orders/'+o.id+'/delivery','POST',{},waiter);
await call('/api/orders/'+o.id+'/payment','POST',{request_key:requestKey(),session_id:cashKey,method:'cash',amount_cents:1000,tendered_cents:2000},cashier);
await call('/api/orders/'+o.id+'/payment','POST',{request_key:requestKey(),session_id:cashKey,method:'pix',amount_cents:2000},cashier);
await call('/api/orders/'+o.id+'/finalize','POST',{},cashier);
assert.equal((await call('/api/orders/'+o.id)).order.state,'closed');
await call('/api/sales/direct','POST',{request_key:requestKey(),session_id:cashKey,method:'cash',tendered_cents:2000,expected_total_cents:1500,items:[{product_id:p.id,quantity:1}]},cashier);
await call('/api/cash/movement','POST',{request_key:requestKey(),session_id:cashKey,kind:'expense',amount_cents:500,description:'Verificação'},cashier);
assert.equal((await call('/api/cash')).session.balance_cents,12000);
assert.equal((await call('/api/finance')).summary.sales_cents,4500);
await call('/api/erp/reports?from=2026-01-01&to=2026-12-31');
await call('/api/cash/close','POST',{session_id:cashKey,counted_methods:{cash:12000,pix:2000,credit:0,debit:0,card:0}},cashier);
assert.equal((await call('/api/products','GET',undefined,waiter)).products[0].cost_cents,undefined);
const inv=await call('/api/erp/inventory','POST',{name:'Insumo temporário',unit:'un',minimum_milli:0,unit_cost_micro:null});
const supplier=await call('/api/erp/suppliers','POST',{name:'Fornecedor temporário'});
const buy=await call('/api/erp/purchases','POST',{request_key:requestKey(),supplier_id:supplier.id,due_date:'2026-12-01',items:[{item_id:inv.id,quantity_milli:10000,total_cents:500}]});
await call('/api/erp/purchases/'+buy.id+'/receive','POST',{});
await call('/api/erp/recipes/'+p.id,'PUT',{mode:'recipe',track_stock:true,items:[{item_id:inv.id,quantity_milli:1000}]});
assert.equal((await call('/api/erp/recipes/'+p.id)).product.cost_cents,50);
await call('/api/erp/inventory');await call('/api/erp/purchases');await call('/api/erp/suppliers');await call('/api/erp/financial');
const account=await call('/api/finance/accounts','POST',{request_key:requestKey(),kind:'payable',title:'Conta temporária',amount_cents:500,due_date:'2026-12-01',recurrence:'monthly'});
await call('/api/finance/accounts/'+account.id+'/settle','POST',{request_key:requestKey(),method:'bank'});
fs.writeFileSync('/workspace/work/erp-flow-trace.json',JSON.stringify(batches));
console.log('Conferido: pedido do garçom, impressão pelo caixa, recebimento dividido, venda direta, despesa, fechamento e custos protegidos. Lotes PostgreSQL:',batches.length);
