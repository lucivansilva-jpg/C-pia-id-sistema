import fs from 'node:fs';
const path='/workspace/lanchonete-login/backend/erp/tenant-ddl.json',commands=JSON.parse(fs.readFileSync(path,'utf8'));
for(let i=0;i<commands.length;i++)if(commands[i].startsWith('CREATE TABLE __SCHEMA__."settings"')&&!commands[i].includes('logo_key'))commands[i]=commands[i].replace('PRIMARY KEY(', '"logo_key" text,"theme_color" text NOT NULL DEFAULT \'#6a330d\',PRIMARY KEY(');
fs.writeFileSync(path,JSON.stringify(commands,null,2));
