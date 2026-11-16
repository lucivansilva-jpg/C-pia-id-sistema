import {api,media,protectResponse,effectivePermissions,PERMISSIONS,PERMISSION_INFO,permissionOverrides} from './core.js';
import {tenantDatabase} from './database.js';
export function createErpGateway({rpc,db,base,service,audit,json,fail,handleInternal}){
return async function gateway(req,route,ctx,business,user){
 const original=new URL(req.url),path=route.slice(4)||'/';
 if(!path.startsWith('/api/')&&!path.startsWith('/media/'))fail(404,'Recurso não encontrado.');
 const principal={...ctx.actor,name:ctx.m.display_name,email:user.email};
 const database=tenantDatabase(business.id,rpc);
 const target=base+'/storage/v1/object/erp-images/'+business.id+'/';
 const storageHeaders={apikey:service,Authorization:'Bearer '+service};
 const bucket={async put(key,buffer,options){const r=await fetch(target+key,{method:'POST',headers:{...storageHeaders,'Content-Type':options.httpMetadata.contentType},body:buffer});if(!r.ok)fail(503,'Não foi possível salvar a foto.')},async delete(key){await fetch(target+key,{method:'DELETE',headers:storageHeaders})},async get(key){const r=await fetch(target+key,{headers:storageHeaders});return r.ok?{body:r.body,httpMetadata:{contentType:r.headers.get('Content-Type')}}:null}};
 if(ctx.support&&req.method!=='GET')await audit(user.id,'erp.mutation.request',business.id,ctx.support.id,null,{method:req.method,path});
 let response;
 if(path==='/api/appearance'){
  const perms=effectivePermissions(principal);if(!perms.includes(req.method==='GET'?'settings.read':'settings.manage'))fail(403,'Permissão insuficiente.');
  if(req.method==='GET')response=json(await database.prepare('SELECT logo_key,theme_color FROM settings WHERE id=1').first());
  else if(req.method==='PUT'){const b=await req.json();if(!/^#[0-9a-f]{6}$/i.test(b.theme_color)||!(b.logo_key===null||typeof b.logo_key==='string'&&/^[a-f0-9-]{36}$/.test(b.logo_key)))fail(400,'Confira a cor e a logomarca.');if(b.logo_key&&!await database.prepare('SELECT key FROM media WHERE key=?').bind(b.logo_key).first())fail(400,'Foto não encontrada.');await database.batch([database.prepare('UPDATE settings SET logo_key=?,theme_color=? WHERE id=1').bind(b.logo_key,b.theme_color),database.prepare('INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'appearance.update','1',new Date().toISOString())]);response=json({ok:true})}else fail(405,'Método não permitido.');
 }else if(path.startsWith('/api/employees')){
  if(!effectivePermissions(principal).includes('employees.manage'))fail(403,'Acesso reservado ao administrador.');
  if(req.method==='GET'&&path==='/api/employees'){
   const members=await db('business_members?select=user_id,username,display_name,role,permissions,active,version&business_id=eq.'+business.id+'&order=created_at');
   response=json({employees:members.map(m=>{const p=ctx.profiles.find(p=>p.role===m.role);return {id:m.user_id,name:m.display_name,username:m.username,role:m.role,permissions:m.permissions,active:m.active,version:m.version,login_ready:true,owner:m.user_id===business.owner_user_id,profile_name:p?.name,inherited_permissions:effectivePermissions({role:m.role,profile_permissions:p?.permissions||{}}),effective_permissions:effectivePermissions({...m,profile_permissions:p?.permissions||{}})}})});
  }else{
   const nextRoute=path.replace('/api/employees','/members'),headers=new Headers(req.headers);headers.set('Content-Type','application/json');
   response=await handleInternal(new Request(original.origin+'/functions/v1/auth-access'+nextRoute,{method:req.method==='PUT'?'PATCH':req.method,headers,body:await req.text()}));
  }
 }else if(path==='/api/profiles'||path.startsWith('/api/profiles/')){
  if(!effectivePermissions(principal).includes('employees.manage'))fail(403,'Acesso reservado ao administrador.');
  if(req.method==='GET'&&path==='/api/profiles')response=json({staff_login:true,profiles:ctx.profiles.map(p=>({...p,effective_permissions:effectivePermissions({role:p.role,profile_permissions:p.permissions})})),permission_catalog:PERMISSIONS.map(id=>({id,group:PERMISSION_INFO[id][0],label:PERMISSION_INFO[id][1],roles:['admin','cashier','waiter'].filter(r=>{try{permissionOverrides({[id]:true},r);return true}catch{return false}})}))});
  else if(req.method==='PUT'&&/^\/api\/profiles\/(admin|cashier|waiter)$/.test(path)){
   const b=await req.json(),role=path.split('/').pop();if(typeof b.name!=='string'||!b.name.trim()||!Number.isInteger(b.version))fail(400,'Confira o perfil.');const permissions=permissionOverrides(b.permissions,role);
   await audit(user.id,'profile.update.request',business.id,ctx.support?.id,role);
   const changed=await db('business_profiles?business_id=eq.'+business.id+'&role=eq.'+role+'&version=eq.'+b.version,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({name:b.name.trim().slice(0,100),permissions,version:b.version+1})});if(!changed.length)fail(409,'O perfil mudou. Atualize a tela.');response=json({ok:true});await audit(user.id,'profile.update',business.id,ctx.support?.id,role);
  }else fail(405,'Método não permitido.');
 }else{
  // Authorization uses the verified membership, never browser-selected role or business.
  const origin=req.headers.get('Origin')||original.origin;
  const logical=new URL(path+original.search,origin),headers=new Headers(req.headers);headers.set('Origin',logical.origin);
  const inner=new Request(logical,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer()});
  const env={PRINCIPAL:principal,DB:database,BUCKET:bucket};
  try{response=path==='/api/media'||path.startsWith('/media/')?await media(inner,env):await protectResponse(principal,await api(inner,env))}catch(e){
   const msg=String(e.message);if(e.status)throw e;if(/stock_qty_nonzero/.test(msg))fail(409,'Estoque insuficiente. Confira os insumos antes de lançar.');throw e;
  }
 }
 if(ctx.support&&response.ok&&req.method!=='GET')await audit(user.id,'erp.mutation.complete',business.id,ctx.support.id,null,{method:req.method,path});
 if(response.headers.get('Content-Type')?.includes('application/json')){
  const value=await response.json();const visit=v=>{if(Array.isArray(v))return v.map(visit);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,typeof x==='string'&&x.startsWith('/media/')?base+'/storage/v1/object/public/erp-images/'+business.id+'/'+x.slice(7):visit(x)]));return v};return json(visit(value),response.status);
 }return response;
}}
