import {createManagement} from './management.js';
// Independent support service. Does not import or replace login, ERP or payment handlers.
import {createSupportTools} from './support.js';
const base=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),publicKey=Deno.env.get('SUPABASE_ANON_KEY');
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-support-session','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:cors});
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
async function body(req){const s=await req.text();if(s.length>16384)fail(413,'Solicitação muito grande.');try{const b=JSON.parse(s);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b}catch{fail(400,'Dados inválidos.')}}
async function db(path,options={}){const r=await fetch(base+'/rest/v1/'+path,{...options,headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json',...options.headers}}),data=await r.json().catch(()=>null);if(!r.ok){if(data?.code==='23505')fail(409,'Esta identificação já está em uso. Escolha outra.');if(String(data?.message).includes('business_has_history'))fail(409,'A loja tem histórico e deve ser desativada.');fail(503,'Não foi possível consultar ou atualizar. Tente novamente.');}return data}
const rpc=(name,args)=>db('rpc/'+name,{method:'POST',body:JSON.stringify(args)});
const audit=(actor,action,business=null,session=null,target=null,details={})=>db('access_audit',{method:'POST',body:JSON.stringify({actor_id:actor,action,business_id:business,support_session_id:session,target_id:target,details})});
async function identity(req){const token=req.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/i)?.[1];if(!token)fail(401,'Entre para continuar.');const r=await fetch(base+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:'Bearer '+token}});if(!r.ok)fail(401,'Sua sessão expirou. Entre novamente.');const user=await r.json();let claims;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))}catch{fail(401,'Sessão inválida.')}if(claims.sub!==user.id||!claims.session_id||!await rpc('business_auth_session_valid',{p_user:user.id,p_session:claims.session_id}))fail(401,'Sua sessão foi encerrada. Entre novamente.');return user}
const management=createManagement({db,rpc,base,service,json,fail,body,audit});
const tools=createSupportTools({db,rpc,body,json,fail,audit});
export async function handle(req){try{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const route=new URL(req.url).pathname.split('/support-access')[1]||'/';
 if(route==='/login'&&req.method==='POST')return await management.login(req);
 const user=await identity(req),admin=(await db('platform_admins?select=user_id,display_name&user_id=eq.'+encodeURIComponent(user.id)+'&active=eq.true'))[0]||null;
 if(route==='/platform/support'&&req.method==='POST'){
  if(!admin)fail(403,'Acesso exclusivo do administrador da plataforma.');const b=await body(req);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.business_id||''))fail(400,'Selecione um estabelecimento.');
  const shop=(await db('businesses?select=id&id=eq.'+b.business_id+'&active=eq.true'))[0];if(!shop)fail(404,'Estabelecimento indisponível.');
  const sessions=await db('support_sessions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({actor_id:user.id,business_id:shop.id,purpose:'Atendimento pela área de suporte',write_enabled:true})});const s=sessions[0];
  await audit(user.id,'support.start',shop.id,s.id,null,{write_enabled:true,source:'support_workspace'});return json({session:s},201);
 }
 const managed=await management.platform(req,route,user,admin);if(managed)return managed;
 const response=await tools.platform(req,route,user,admin);if(response)return response;
 if(admin)fail(403,'Abra os chamados pela sua área de suporte.');
 const member=(await db('business_members?select=user_id,business_id,display_name,role,active,must_change_password&user_id=eq.'+encodeURIComponent(user.id)))[0];
 if(!member?.active)fail(403,'Acesso indisponível. Fale com o proprietário.');if(member.must_change_password)fail(428,'Troque a senha temporária para continuar.');
 const business=(await db('businesses?select=id,active&id=eq.'+member.business_id+'&active=eq.true'))[0];if(!business)fail(403,'Estabelecimento indisponível.');
 const access=await management.customer(req,route,user,member,business);if(access)return access;
 const result=await tools.customer(req,route,user,{m:member},business);if(result)return result;fail(404,'Opção não encontrada.');
}catch(e){return json({error:e.status?e.message:'Não foi possível concluir a solicitação de suporte.'},e.status||500)}}
Deno.serve(handle);
