import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,stat,realpath} from 'node:fs/promises';
const root=fileURLToPath(new URL('../web/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.sql':'text/plain; charset=utf-8','.wasm':'application/wasm','.ico':'image/x-icon'};
export async function handle(req,res){try{
 const requested=decodeURIComponent(new URL(req.url,'http://preview.local').pathname);
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('A prévia não executa serviços remotos.');return}
 if(requested==='/healthz'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',mode:'demo-only',production_connected:false}));return}
 if(requested==='/'){res.writeHead(302,{Location:'/demo/'});res.end();return}
 if(requested==='/login'){res.writeHead(302,{Location:'/login/'});res.end();return}
 if(requested.startsWith('/api/')||requested.startsWith('/media/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Backend desconectado nesta prévia. Use /demo/ para a simulação.'}));return}
 if(requested.split('/').some(part=>part.startsWith('.'))){res.writeHead(404);res.end();return}
 const mapped=requested==='/login/'?'/index.html':requested.startsWith('/login/')?requested.slice('/login'.length):requested;
 let target=path.resolve(root,'.'+mapped);
 if(!target.startsWith(root)){res.writeHead(404);res.end();return}
 let info=await stat(target);if(info.isDirectory())target=path.join(target,'index.html');
 target=await realpath(target);if(!target.startsWith(root)){res.writeHead(404);res.end();return}
 const body=await readFile(target);res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');res.writeHead(200);res.end(req.method==='HEAD'?undefined:body);
}catch{res.writeHead(404);res.end('Arquivo não encontrado.')}}
export const server=http.createServer(handle);
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3000);server.listen(port,'0.0.0.0',()=>console.log(`ID Sistema: prévia de demonstração na porta ${port}. Banco de produção desconectado.`));
}
