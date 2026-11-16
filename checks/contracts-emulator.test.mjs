import fs from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,writeBatch,runTransaction,serverTimestamp,Timestamp} from 'firebase/firestore';
import '../web/contract.js';
assert.equal(IDContract.modules({businessKind:'retail'}).tables,false);
assert.equal(IDContract.modules({businessKind:'food'}).finance,true);
assert.equal(IDContract.modules({modules:{},businessKind:'food'}).finance,false);
assert.throws(()=>IDContract.limit(1.5));
assert.equal(IDContract.normalize({tables:true,finance:true},'retail').tables,false);
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Exige emulador local em 127.0.0.1:8185.');
const env=await initializeTestEnvironment({projectId:'demo-idsistema-test',firestore:{host:'127.0.0.1',port:8185,rules:fs.readFileSync('firestore.rules','utf8')}});
const base={tables:false,finance:false,inventory:false,costs:false};
const member=(uid,active=true)=>({uid,businessId:'contract_test',name:uid,username:uid,role:'cashier',permissions:{},active,mustChangePassword:false,isOwner:false,version:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
const sref=db=>doc(db,'businesses','contract_test','settings','main');
const mref=(db,uid)=>doc(db,'businesses','contract_test','members',uid);
const owner=env.authenticatedContext('contract_owner',{email:'owner@test.invalid'}).firestore();
const platform=env.authenticatedContext('platform_contract',{email:'lucivan.silva@gmail.com',email_verified:true}).firestore();
try{
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),ts=Timestamp.now();
  await setDoc(doc(db,'businesses','contract_test'),{id:'contract_test',name:'Teste isolado',code:'contracttest',active:true,deleted:false,ownerUid:'contract_owner',ownerName:'Proprietário',createdAt:ts,updatedAt:ts});
  await setDoc(sref(db),{name:'Teste isolado',mode:'complete',paper:80,businessKind:'food',blindClose:false,modules:base,userLimit:1,activeUserCount:1,updatedAt:ts});
  await setDoc(mref(db,'contract_owner'),{...member('contract_owner'),role:'admin',isOwner:true,createdAt:ts,updatedAt:ts});
 });
 await assertFails(updateDoc(sref(owner),{modules:{...base,finance:true},updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(sref(owner),{userLimit:99,updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(sref(owner),{activeUserCount:0,updatedAt:serverTimestamp()}));
 await assertFails(setDoc(mref(owner,'bypass_user'),member('bypass_user')));
 await assertFails(getDoc(doc(owner,'businesses','contract_test','accounts','hidden_account')));
 await assertFails(getDoc(doc(owner,'businesses','contract_test','products','hidden_product','private','cost')));
 await assertFails(getDoc(doc(owner,'businesses','contract_test','inventoryItems','hidden_inventory')));
 await assertFails(getDoc(doc(owner,'businesses','contract_test','tables','1')));
 console.log('PASS contrato: proprietário não altera módulos/limite/contador; módulos bloqueiam chamadas diretas.');
 await assertSucceeds(updateDoc(sref(platform),{userLimit:2,updatedAt:serverTimestamp()}));
 // Two legitimate simultaneous activations contend for exactly one vacancy.
 async function add(uid){return runTransaction(owner,async tx=>{
   const sr=sref(owner);const ss=await tx.get(sr);const cfg=ss.data();
   if(cfg.activeUserCount>=cfg.userLimit)throw Error('Sem vaga');
   tx.set(mref(owner,uid),member(uid));
   tx.update(sr,{activeUserCount:cfg.activeUserCount+1,activeUserChangeUid:uid,updatedAt:serverTimestamp()});
 });}
 const outcomes=await Promise.allSettled([add('simultaneous_one'),add('simultaneous_two')]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await getDoc(sref(owner))).data().activeUserCount,2);
 console.log('PASS concorrência: apenas um de dois cadastros simultâneos ocupa a última vaga.');
 // Same-counter multi-member injection must fail even below limit.
 await updateDoc(sref(platform),{userLimit:4,updatedAt:serverTimestamp()});
 const batch=writeBatch(owner);batch.set(mref(owner,'injected_one'),member('injected_one'));batch.set(mref(owner,'injected_two'),member('injected_two'));batch.update(sref(owner),{activeUserCount:3,activeUserChangeUid:'injected_one',updatedAt:serverTimestamp()});
 await assertFails(batch.commit());
 console.log('PASS fraude: dois usuários não podem reutilizar um único incremento do contador.');
 const winner=outcomes[0].status==='fulfilled'?'simultaneous_one':'simultaneous_two';
 const off=writeBatch(owner);off.update(mref(owner,winner),{active:false,version:2,updatedAt:serverTimestamp()});off.update(sref(owner),{activeUserCount:1,activeUserChangeUid:winner,updatedAt:serverTimestamp()});await assertSucceeds(off.commit());
 await assertSucceeds(updateDoc(sref(platform),{userLimit:1,updatedAt:serverTimestamp()}));
 const on=writeBatch(owner);on.update(mref(owner,winner),{active:true,version:3,updatedAt:serverTimestamp()});on.update(sref(owner),{activeUserCount:2,activeUserChangeUid:winner,updatedAt:serverTimestamp()});await assertFails(on.commit());
 console.log('PASS reativação e desativação: vaga liberada e limite novamente respeitado.');
 await assertSucceeds(updateDoc(sref(platform),{modules:{...base,finance:true},updatedAt:serverTimestamp()}));
 await assertSucceeds(getDoc(doc(owner,'businesses','contract_test','accounts','empty')));
 const outsider=env.authenticatedContext('not_a_member').firestore();await assertFails(getDoc(sref(outsider)));
 console.log('PASS módulos independentes: financeiro com 1 usuário, mantendo isolamento entre empresas.');
 console.log('CONTRACT_EMULATOR_TESTS_PASSED');
}finally{await env.cleanup();}
