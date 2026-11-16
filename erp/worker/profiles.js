const PERMISSION_INFO={
'profile.read':['Acesso','Consultar a própria identificação'],
'settings.read':['Acesso','Consultar dados do estabelecimento'],
'settings.manage':['Administração','Alterar configurações do sistema'],
'catalog.read':['Produtos','Consultar produtos e preços'],
'products.manage':['Produtos','Cadastrar, editar e remover produtos'],
'products.costs':['Gestão','Consultar e alterar custos'],
'tables.read':['Atendimento','Consultar mesas'],
'tables.manage':['Atendimento','Cadastrar mesas'],
'orders.read':['Atendimento','Consultar as próprias comandas'],
'orders.shared':['Atendimento','Consultar e atender comandas de outros funcionários'],
'orders.create':['Atendimento','Lançar pedidos e produtos'],
'orders.update':['Atendimento','Acrescentar itens nas comandas permitidas'],
'orders.deliver':['Atendimento','Marcar produtos como entregues'],
'orders.print':['Atendimento','Imprimir comanda, conferência e cupom'],
'orders.cancel':['Atendimento','Cancelar comanda com motivo'],
'drafts.manage':['Atendimento','Guardar e retomar vendas ainda não lançadas'],
'favorites.manage':['Produtos','Organizar os próprios favoritos'],
'cash.access':['Caixa','Acessar o PDV e consultar o caixa'],
'cash.open':['Caixa','Abrir caixa'],
'cash.close':['Caixa','Fechar e conferir caixa'],
'cash.movements':['Caixa','Registrar suprimento e sangria'],
'expenses.create':['Caixa','Lançar despesa paga pela gaveta'],
'payments.receive':['Caixa','Receber, finalizar venda e colocar conta em espera'],
'payments.refund':['Caixa','Registrar estorno com motivo e confirmação'],
'discounts.authorize':['Caixa','Aplicar desconto com motivo'],
'finance.view':['Gestão','Consultar financeiro gerencial'],
'finance.manage':['Gestão','Gerenciar contas a pagar e receber'],
'reports.view':['Gestão','Acessar relatórios, estoque, compras e fornecedores'],
'employees.manage':['Administração','Administrar funcionários, perfis e permissões']};
function permissionOverrides(value,role){if(!Object.hasOwn(ROLE_BASE,role))fail(400,'Perfil inválido.');let out={};if(Array.isArray(value)){for(const p of value){if(!roleAllows(role,p))fail(400,'Permissão incompatível com o perfil.');out[p]=true}}else{if(!value||typeof value!=='object')fail(400,'Permissões inválidas.');for(const [p,v] of Object.entries(value)){if(!PERMISSIONS.includes(p)||typeof v!=='boolean'||(v&&!roleAllows(role,p))||(role==='admin'&&!v))fail(400,'Permissão incompatível com o perfil.');out[p]=v}}return out}
async function profileApi(req,env,user,path){if(!(path==='/api/profiles'||path.startsWith('/api/profiles/')||path==='/api/employees'||path.startsWith('/api/employees/')))return null;assertPermission(user,'employees.manage');const db=env.DB,method=req.method;
const listProfiles=async()=>(await db.prepare('SELECT * FROM role_profiles ORDER BY role').all()).results.map(p=>({...p,permissions:JSON.parse(p.permissions),effective_permissions:effectivePermissions({role:p.role,profile_permissions:JSON.parse(p.permissions)})}));
if(path==='/api/profiles'&&method==='GET')return json({profiles:await listProfiles(),permission_catalog:PERMISSIONS.map(id=>({id,group:PERMISSION_INFO[id][0],label:PERMISSION_INFO[id][1],roles:['admin','cashier','waiter'].filter(r=>roleAllows(r,id))})),staff_login:false});
const profile=path.match(/^\/api\/profiles\/(admin|cashier|waiter)$/);if(profile&&method==='PUT'){const b=await body(req);if(!clean(b.name,100)||!num(b.version,1,1e9))fail(400,'Confira nome e versão do perfil.');const overrides=permissionOverrides(b.permissions,profile[1]);const result=await db.batch([stmt(db,'UPDATE role_profiles SET name=?,permissions=?,version=version+1,updated_at=?,updated_by=? WHERE role=? AND version=?',clean(b.name,100),JSON.stringify(overrides),now(),user.id,profile[1],b.version),stmt(db,"INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT ?,?,'profile.permissions.update',?,? WHERE changes()=1",crypto.randomUUID(),user.id,profile[1],now())]);if(!result[0].meta.changes)fail(409,'O perfil foi alterado. Atualize antes de salvar.');return json({ok:true})}
if(path==='/api/employees'&&method==='GET'){const ps=await listProfiles(),rows=(await db.prepare('SELECT id,name,username,role,permissions,active,version FROM employees ORDER BY name LIMIT 200').all()).results;return json({employees:rows.map(e=>{const permissions=JSON.parse(e.permissions),profile=ps.find(p=>p.role===e.role);return {...e,permissions,active:!!e.active,login_ready:false,profile_name:profile?.name||e.role,inherited_permissions:profile?.effective_permissions||[],effective_permissions:effectivePermissions({...e,profile_permissions:profile?.permissions||{},permissions})}})})}
const employee=path.match(/^\/api\/employees\/([^/]+)$/);if((path==='/api/employees'&&method==='POST')||(employee&&method==='PUT')){const b=await body(req),name=clean(b.name,100),username=clean(b.username,40).toLowerCase();if(!name||!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)||!Object.hasOwn(ROLE_BASE,b.role))fail(400,'Informe nome, usuário único e perfil válido.');const permissions=permissionOverrides(b.permissions??{},b.role);const duplicate=await stmt(db,'SELECT id FROM employees WHERE username=?',username).first();if(duplicate&&duplicate.id!==employee?.[1])fail(409,'Este nome de usuário já está em uso.');if(employee){if(!num(b.version,1,1e9)||typeof b.active!=='boolean')fail(400,'Confira versão e situação do funcionário.');const result=await db.batch([stmt(db,'UPDATE employees SET name=?,username=?,role=?,permissions=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?',name,username,b.role,JSON.stringify(permissions),b.active?1:0,now(),employee[1],b.version),stmt(db,"INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT ?,?,'employee.permissions.update',?,? WHERE changes()=1",crypto.randomUUID(),user.id,employee[1],now())]);if(!result[0].meta.changes)fail(409,'O cadastro foi alterado. Atualize antes de salvar.');return json({ok:true,login_ready:false})}const id=crypto.randomUUID();await db.batch([stmt(db,'INSERT INTO employees(id,name,username,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,name,username,b.role,JSON.stringify(permissions),now(),now()),audit(db,user,'employee.prepare',id)]);return json({ok:true,id,login_ready:false},201)}return null}
