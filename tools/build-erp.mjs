import fs from 'node:fs';
const root='/workspace/sites/mesa-caixa',out='/workspace/lanchonete-login';
let core=['profiles','direct-sale','erp','permissions','operations','finance','api'].map(n=>fs.readFileSync(`${root}/worker/${n}.js`,'utf8')).join('\n');
core=core.slice(0,core.indexOf('export default'));
core=core.replace(/function auth\(req,env\)\{[^\n]+/,'function auth(req,env){if(!env.PRINCIPAL)fail(401,"Entre para continuar.");return env.PRINCIPAL;}');
core=core.replace(/async function withRoleProfile\(user,db\)\{[^\n]+/,'async function withRoleProfile(user,db){return user;}');
core=core.replace('staff_login:false','staff_login:true');
core='async function platformSetupApi(){return null;}\n'+core+'\nexport {api,media,protectResponse,effectivePermissions,PERMISSIONS,PERMISSION_INFO,permissionOverrides};\n';
fs.writeFileSync(out+'/backend/erp/core.js',core);
fs.mkdirSync(out+'/web/system',{recursive:true});
// Bootstrap only: existing integrated frontend is maintained directly and must not be overwritten.
if(!fs.existsSync(out+'/web/system/access-ui.js'))for(const name of fs.readdirSync(root+'/web').filter(n=>/\.(html|css|js)$/.test(n)&&n!=='platform-setup.js')){
 let s=fs.readFileSync(root+'/web/'+name,'utf8');
 s=s.replaceAll('Lanches Progresso','Minha lanchonete').replaceAll('LANCHES PROGRESSO','MINHA LANCHONETE').replaceAll('/brand-logo.png','/system/brand.svg');
 if(name==='index.html')s=s.replace('<script src="app.js" defer>','<script src="/supabase-2.119.0.js"></script><script src="/config.js"></script><script src="bootstrap.js"></script><script src="app.js" defer>').replace('<script src="platform-setup.js" defer></script>','<script src="access-ui.js" defer></script>');
 if(name==='print.html')s=s.replace('<script','<script src="/supabase-2.119.0.js"></script><script src="/config.js"></script><script src="bootstrap.js"></script><script');
 if(name==='admin.js'){
 s=s.replace("request('/api/employees')","(live.sessionUser.permissions.includes('employees.manage')?request('/api/employees'):Promise.resolve({employees:[]}))").replace("request('/api/profiles')","(live.sessionUser.permissions.includes('employees.manage')?request('/api/profiles'):Promise.resolve({profiles:[]}))");
 s=s.replace("live.ready=true;await reload()","live.ready=true;if(!live.sessionUser.permissions.includes('reports.view')&&(!location.hash||location.hash==='#inicio')){current=live.sessionUser.permissions.includes('cash.access')?'caixa':'mesas';location.hash='#'+current;}await reload()");
 }
 if(name==='pdv.js')s=s.replace("request('/api/cash'),request('/api/orders')","(canOperate('cash.access')?request('/api/cash'):Promise.resolve({session:null,history:[],movements:[]})),request('/api/orders')");
 if(name==='role-ui.js'){
 s=s.replace('O login individual ainda está pendente. Estes cadastros não criam senhas nem liberam acesso externo.','Cada pessoa entra com o código da loja, seu usuário e sua senha.').replaceAll('Ativo · login pendente','Ativo');
 s=s.replace('<p class="notice">O cadastro prepara o usuário. O login individual ainda não está disponível e nenhuma senha é coletada nesta tela.</p>','${id?\'\':\'<label>Senha temporária<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><p class="sub">O funcionário deve trocar esta senha no primeiro acesso.</p>\'}');
 s=s.replace('name:f.get(\'name\'),username:',"password:f.get('password')||undefined,name:f.get('name'),username:");
 }
 s=s.replaceAll('rel="noopener"','');
 fs.writeFileSync(out+'/web/system/'+name,s);
}
if(!fs.existsSync(out+'/web/system/brand.svg'))fs.writeFileSync(out+'/web/system/brand.svg','<svg xmlns="http://www.w3.org/2000/svg" width="190" height="68" viewBox="0 0 190 68"><rect width="190" height="68" rx="8" fill="#6b330e"/><text x="95" y="41" text-anchor="middle" font-family="sans-serif" font-size="21" fill="#fff">Meu estabelecimento</text></svg>');
