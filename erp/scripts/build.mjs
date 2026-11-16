import {readFile,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const assets={};for(const file of ['index.html','style.css','app.js','admin.js','receipts.js','pdv.js','commands.js','operation-ui.js','erp-ui.js','print.html','print-page.js','role-ui.js','platform-setup.js'])assets['/'+file]=await readFile('web/'+file,'utf8');
const backend=await readFile('worker/platform-setup.js','utf8')+'\n'+await readFile('worker/profiles.js','utf8')+'\n'+await readFile('worker/direct-sale.js','utf8')+'\n'+await readFile('worker/erp.js','utf8')+'\n'+await readFile('worker/permissions.js','utf8')+'\n'+await readFile('worker/operations.js','utf8')+'\n'+await readFile('worker/catalog-import.js','utf8')+'\n'+await readFile('worker/finance.js','utf8')+'\n'+await readFile('worker/api.js','utf8');
await writeFile('dist/server/index.js','const BRAND_LOGO='+JSON.stringify((await readFile('web/brand-logo.png')).toString('base64'))+';\nconst ASSETS='+JSON.stringify(assets)+';\n'+backend);
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json','utf8'));
await mkdir('dist/server/drizzle/meta',{recursive:true});
for (const f of [...(await readdir('drizzle')).filter(f=>f.endsWith('.sql')),'meta/_journal.json']) await writeFile('dist/server/drizzle/'+f,await readFile('drizzle/'+f));
console.log('Worker, interface e migrações compilados.');
