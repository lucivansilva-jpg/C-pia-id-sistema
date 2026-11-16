import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const f of ['web/demo/index.html','web/demo/runtime.js','web/demo/store.js','web/demo/engine.js','web/demo/schema.sql','exportacao-supabase/dados/snapshot.json','exportacao-supabase/RESTAURACAO.md'])assert.ok(fs.existsSync(path.join(root,f)),f);
const data=JSON.parse(fs.readFileSync(path.join(root,'exportacao-supabase/dados/snapshot.json'),'utf8'));assert.equal(data.tables.length,60);for(const t of data.tables)assert.equal(t.rows.length,t.row_count);
assert.ok(!fs.readFileSync(path.join(root,'web/config.js'),'utf8').includes('theshzemzvhwmulcvdgb'));
const demo=fs.readFileSync(path.join(root,'web/demo/index.html'),'utf8');assert.ok(!demo.includes('/config.js'));assert.ok(!demo.includes('bootstrap.js'));
console.log('Pacote conferido: código, 60 tabelas exportadas e demonstração isolada.');
