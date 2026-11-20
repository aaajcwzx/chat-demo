const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.CHAT_PLAYWRIGHT || '/home/ubuntu/.cache/chat-demo/browser-tools/node_modules/playwright');
const qa=JSON.parse(fs.readFileSync('/home/ubuntu/.cache/chat-demo/backend-qa/qa.json'));
const user=(qa.browserUsers||qa.testUsers)[0], checks=[];
const root='/home/ubuntu/chat-demo/dist';
const sourceOrigin='http://101.34.83.198',targetOrigin='https://101.34.83.198';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'};
const session={id:'http-origin-record',title:'HTTP 原页面历史',createdAt:1700000000000,updatedAt:1700000000000,rootMessageId:'http-q',messages:[
  {id:'http-q',role:'user',content:'原页面消息',files:[{id:'http-file',serverId:null,name:'old.txt',size:10,isImage:false,mimeType:'text/plain'}],createdAt:1700000000000,parentId:null,selectedChildId:'http-a'},
  {id:'http-a',role:'assistant',status:'done',createdAt:1700000000000,blocks:[{type:'text',text:'旧回答'}],parentId:'http-q',selectedChildId:null},
]};
(async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try {
    const context=await browser.newContext({locale:'zh-CN',ignoreHTTPSErrors:false,viewport:{width:1200,height:800}});
    const routeApp=async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname.startsWith('/api/')) {
        const headers={...request.headers(),'x-forwarded-proto':url.protocol.slice(0,-1)};
        const response=await route.fetch({url:'http://127.0.0.1:8093'+url.pathname+url.search,headers});
        return route.fulfill({response});
      }
      const name=url.pathname==='/'?'/index.html':url.pathname;
      const file=path.resolve(root,'.'+name);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({path:file,contentType:mime[path.extname(file)]||'application/octet-stream'});
    };
    await context.route(sourceOrigin+'/**',routeApp);await context.route(targetOrigin+'/**',routeApp);
    await context.route('https://api.deepseek.com/**',route=>route.abort());
    const source=await context.newPage();source.setDefaultTimeout(20000);
    await source.goto(sourceOrigin+'/',{waitUntil:'networkidle'});
    await source.evaluate(async session=>{
      await new Promise(resolve=>{
        const r=indexedDB.open('chat-demo',11);r.onsuccess=()=>{
          const db=r.result,tx=db.transaction(['sessions','sessionSummaries','files'],'readwrite');
          tx.objectStore('sessions').put(session);tx.objectStore('sessionSummaries').put({id:session.id,title:session.title,createdAt:session.createdAt,updatedAt:session.updatedAt,fileIds:['http-file']});
          tx.objectStore('files').put({id:'http-file',blob:new Blob(['HTTP original ✓'],{type:'text/plain'})});
          tx.oncomplete=()=>{db.close();resolve()};
        };
      });
    },session);
    await source.getByRole('button',{name:'登录',exact:true}).click();
    const popup=context.waitForEvent('page');
    await source.getByRole('button',{name:'打开安全登录页面',exact:true}).click();
    const target=await popup;target.setDefaultTimeout(20000);await target.waitForLoadState('networkidle');
    assert.equal(new URL(target.url()).origin,targetOrigin);
    await target.getByRole('button',{name:'登录',exact:true}).click();
    const login=target.getByRole('dialog',{name:'登录',exact:true});
    await login.getByLabel('用户名',{exact:true}).fill(user.username);await login.getByLabel('密码',{exact:true}).fill(user.password);
    await login.getByRole('button',{name:'登录',exact:true}).click();await login.waitFor({state:'hidden'});
    const transfer=source.getByRole('dialog',{name:'迁移浏览器数据',exact:true});await transfer.waitFor();
    const waiting=target.getByRole('dialog',{name:'迁移浏览器数据',exact:true});await waiting.waitFor();
    await waiting.getByText('请回到原 HTTP 页面，确认将浏览器数据交给当前安全页面。',{exact:true}).waitFor();
    const token=new URL(target.url()).searchParams.get('from-browser');
    await target.evaluate(({token,origin})=>window.postMessage({type:'chat-demo:browser-snapshot',nonce:token,snapshot:{sessions:[],files:[],channels:{channels:[],modelLists:{}}}},origin),{token,origin:targetOrigin});
    await target.waitForTimeout(200);
    assert.equal(await waiting.getByRole('button',{name:'确认导入当前账号',exact:true}).count(),0);
    checks.push('HTTP 原页面打开 HTTPS 登录，来源窗口不匹配的消息被拒绝');
    await transfer.getByRole('button',{name:'允许传送到安全页面',exact:true}).click();await transfer.waitFor({state:'hidden'});
    await waiting.getByText('找到 1 个对话、1 个附件',{exact:true}).waitFor();
    const before=await target.evaluate(async id=>(await(await fetch('/api/chat/sessions')).json()).data.list.some(row=>row.id===id),session.id);
    assert.equal(before,false);
    await waiting.getByRole('checkbox').uncheck();
    await waiting.getByRole('button',{name:'确认导入当前账号',exact:true}).click();await waiting.waitFor({state:'hidden'});
    const saved=await target.evaluate(async id=>({session:(await(await fetch('/api/chat/sessions/'+id)).json()).data.session,file:await(await fetch('/api/chat/files/http-file')).text()}),session.id);
    assert.equal(saved.session.title,session.title);assert.equal(saved.file,'HTTP original ✓');
    const count=await source.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('chat-demo',11);r.onsuccess=()=>{const db=r.result,q=db.transaction('sessions').objectStore('sessions').count();q.onsuccess=()=>{db.close();resolve(q.result)}}}));
    assert.equal(count,1);checks.push('两个明确确认之后跨协议迁移会话与 Blob，原 HTTP IndexedDB 保留');
    const cookies=await context.cookies(targetOrigin+'/api/chat');const cookie=cookies.find(cookie=>cookie.name==='chat-session');
    assert.ok(cookie.secure&&cookie.httpOnly);checks.push('HTTPS 登录 Cookie 同时启用 Secure 和 HttpOnly');
    await target.screenshot({path:'/home/ubuntu/.cache/chat-demo/https-migration-complete.png'});
    console.log(JSON.stringify({passed:checks.length,checks}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
