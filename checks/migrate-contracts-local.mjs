// Explicit legacy migration rehearsal. No Google credentials and no remote endpoint accepted.
import fs from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,getDocs,doc,getDoc,runTransaction,serverTimestamp} from 'firebase/firestore';
import '../web/contract.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Migração permitida somente no emulador local 127.0.0.1:8185.');
const apply=process.argv.includes('--apply');
const env=await initializeTestEnvironment({projectId:'demo-idsistema-test',firestore:{host:'127.0.0.1',port:8185}});
try{await env.withSecurityRulesDisabled(async ctx=>{
 const db=ctx.firestore(),businesses=await getDocs(collection(db,'businesses'));
 const report=[];
 for(const b of businesses.docs){
  const ref=doc(db,'businesses',b.id,'settings','main'),ss=await getDoc(ref);
  if(!ss.exists()||ss.data().activeUserCount!=null)continue;
  const members=await getDocs(collection(db,'businesses',b.id,'members'));
  const count=members.docs.filter(d=>d.data().active).length;
  const cfg=ss.data();
  const patch={modules:IDContract.modules(cfg),activeUserCount:count,userLimit:Math.max(1,count),updatedAt:serverTimestamp()};
  report.push({businessId:b.id,activeUsers:count,userLimit:patch.userLimit,modules:patch.modules,action:apply?'apply-local':'dry-run'});
  if(apply)await runTransaction(db,async tx=>{
   const current=await tx.get(ref);const snapshots=await Promise.all(members.docs.map(d=>tx.get(d.ref)));
   if(current.data().activeUserCount!=null)throw Error('Contrato já migrado; atualize o relatório.');
   const currentCount=snapshots.filter(d=>d.exists()&&d.data().active).length;
   tx.update(ref,{...patch,activeUserCount:currentCount,userLimit:Math.max(1,currentCount)});
   const id=crypto.randomUUID();tx.set(doc(db,'businesses',b.id,'auditLogs',id),{id,actorId:'local-migration',action:'business.contract.migration',entityId:b.id,createdAt:serverTimestamp()});
  });
 }
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/contracts-migration.json',JSON.stringify({localOnly:true,apply,report},null,2));
 console.log(JSON.stringify({localOnly:true,apply,establishments:report.length}));
});}finally{await env.cleanup();}
