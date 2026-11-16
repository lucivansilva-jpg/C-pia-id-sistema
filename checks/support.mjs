import assert from 'node:assert/strict';import {createSupportTools} from '../backend/support.js';
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',user={id:'20000000-0000-4000-8000-000000000001'},id='30000000-0000-4000-8000-000000000001';let writes=0,argumentsUsed=null;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status}),fail=(status,message)=>{throw Object.assign(Error(message),{status})};
const tools=createSupportTools({json,fail,body:req=>req.json(),audit:async()=>{},db:async(path,options)=>{if(options?.method){writes++;return []}if(path.startsWith('support_tickets?')){if(path.includes('&business_id=eq.'+a)&&path.includes('&id=eq.'+id))return [];return [{id,business_id:b,created_by:user.id,subject:'Teste',version:1}]}return []},rpc:async(name,args)=>{argumentsUsed={name,args};return {id,business_id:a,subject:'Teste',number:1}}});
function req(path,method='GET',body){return new Request('https://isolated.test'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})}
const ctx={m:{business_id:a,display_name:'Cliente A',role:'waiter'}};
await assert.rejects(()=>tools.customer(req('/tickets/'+id),'/tickets/'+id,user,ctx,{id:a}),e=>e.status===404);assert.equal(writes,0);
await assert.rejects(()=>tools.platform(req('/platform/tickets'),'/platform/tickets',user,null),e=>e.status===403);
let seenPath='';const scoped=createSupportTools({json,fail,body:req=>req.json(),audit:async()=>{},rpc:async()=>{},db:async path=>{seenPath=path;return []}});
await scoped.customer(req('/tickets?business_id='+b),'/tickets',user,ctx,{id:a});assert.ok(seenPath.includes('business_id=eq.'+a));assert.ok(seenPath.includes('created_by=eq.'+user.id));assert.ok(!seenPath.includes(b));
const create={subject:'Erro no produto',message:'Preciso de ajuda.',category:'error',priority:'normal',request_key:crypto.randomUUID(),business_id:b,actor_id:'spoofed'};
assert.equal((await tools.customer(req('/tickets','POST',create),'/tickets',user,ctx,{id:a})).status,201);assert.equal(argumentsUsed.args.p_business,a);assert.equal(argumentsUsed.args.p_actor,user.id);
await tools.customer(req('/presence','POST',{route:'caixa',user_id:'spoofed'}),'/presence',user,ctx,{id:a});assert.equal(argumentsUsed.args.p_actor,user.id);
await assert.rejects(()=>tools.customer(req('/tickets'),'/tickets',user,{...ctx,support:{}},{id:a}),e=>e.status===403);
console.log('Conferido: chamados isolados por empresa e autor, plataforma exclusiva, identidade obtida da sessão e suporte sem criar chamados como cliente.');
