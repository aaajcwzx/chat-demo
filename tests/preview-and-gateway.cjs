const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.CHAT_FRONTEND_DIST || '/home/ubuntu/chat-demo/dist';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png' };
const preview = http.createServer((request, response) => {
  if (request.url.startsWith('/api/')) {
    const upstream = http.request({ host:'127.0.0.1', port:8093, path:request.url, method:request.method, headers:request.headers }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy()); request.pipe(upstream); return;
  }
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { file = path.join(root, 'index.html'); }
  if (!fs.existsSync(file)) { response.writeHead(503); response.end('Build in progress'); return; }
  response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-store');
  const content=fs.createReadStream(file);content.on('error',()=>response.destroy());content.pipe(response);
});
const gateway = http.createServer(async (request, response) => {
  const address = new URL(request.url, 'http://localhost');
  const secret = request.headers.authorization?.replace(/^Bearer /, '') || '';
  if (address.pathname.endsWith('/models')) {
    response.writeHead(200, {'Content-Type':'application/json'});
    response.end(JSON.stringify({data:[{id:'fixture/alpha'},{id:'fixture/beta'},{id:'fixture/gamma'}]})); return;
  }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400); response.end(); return; }
  const question = body.messages?.at(-1)?.content || '';
  if (question.includes('gateway-error')) {
    response.writeHead(402, {'Content-Type':'application/json'});
    response.end(JSON.stringify({error:{message:'fixture upstream failure ' + secret}})); return;
  }
  response.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','x-request-id':'fixture-' + secret});
  const event = value => `data: ${JSON.stringify(value)}\n\n`;
  if (question.includes('slow')) {
    response.write(event({id:'slow',choices:[{delta:{content:'已开始生成'},finish_reason:null}]}));
    const timer = setInterval(() => response.write(event({choices:[{delta:{content:'继续'},finish_reason:null}]})),150);
    response.on('close', () => clearInterval(timer)); return;
  }
  const chunks = [
    {id:'cloud-fixture',model:body.model,choices:[{delta:{role:'assistant'},finish_reason:null}]},
    {choices:[{delta:{reasoning_content:'模拟分析。'},finish_reason:null}]},
    {choices:[{delta:{content:'云端中文 ✓ 回复 ' + (question.includes('redact') ? secret : '')},finish_reason:null}]},
    {choices:[{delta:{},finish_reason:'stop'}]},
    {choices:[],usage:{prompt_tokens:10,completion_tokens:5}},
  ];
  const output = Buffer.from(chunks.map(event).join('') + 'data: [DONE]\n\n');
  for (let offset=0;offset<output.length;offset+=7) {
    if (response.destroyed) return;
    response.write(output.subarray(offset,offset+7)); await new Promise(resolve => setTimeout(resolve,2));
  }
  response.end();
});
preview.listen(8091, '127.0.0.1');
gateway.listen(19095, '172.18.0.1');
console.log('QA preview: 127.0.0.1:8091; fake gateway on Docker bridge only.');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { preview.close(); gateway.close(); process.exit(0); });
