const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.CHAT_PLAYWRIGHT || '/home/ubuntu/.cache/chat-demo/browser-tools/node_modules/playwright');
const qa=JSON.parse(fs.readFileSync('/home/ubuntu/.cache/chat-demo/backend-qa/qa.json'));
const [a,b]=qa.testUsers;
const url='http://127.0.0.1:8091/';
const checks=[],errors=[],requests=[];
const localSecret='fixture-browser-local-key';
const replacement='fixture-browser-replacement-key';
const localSession={id:'local-browser-history',title:'仅本地的旧记录',createdAt:1700000000000,updatedAt:1700000000000,rootMessageId:'local-q',messages:[
  {id:'local-q',role:'user',createdAt:1700000000000,content:'本地历史提问',files:[{id:'local-doc',serverId:null,name:'original.txt',size:14,isImage:false,mimeType:'text/plain'}],parentId:null,selectedChildId:'local-a'},
  {id:'local-a',role:'assistant',createdAt:1700000000000,status:'done',model:'fixture/alpha',channelId:'browser-channel',channelProtocol:'openai',blocks:[{type:'text',text:'本地历史回答'}],parentId:'local-q',selectedChildId:null},
]};
async function login(page,user) {
  await page.goto(url,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'登录',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'登录',exact:true});
  await dialog.getByLabel('用户名',{exact:true}).fill(user.username);
  await dialog.getByLabel('密码',{exact:true}).fill(user.password);
  await dialog.getByRole('button',{name:'登录',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'账号与同步',exact:true}).waitFor();
}
async function cloud(page,path,method='GET',data) {
  return page.evaluate(async ({path,method,data})=>{
    const me=await(await fetch('/api/chat/auth/me')).json();
    const result=await fetch('/api/chat'+path,{method,headers:{'Content-Type':'application/json','X-Chat-Owner':String(me.data.id)},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:result.status,body:await result.json().catch(()=>null)};
  },{path,method,data});
}
async function send(page,text) {
  const input=page.locator('textarea'); await input.fill(text); await input.press('Enter');
  await page.getByText('云端中文 ✓ 回复',{exact:true}).last().waitFor();
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="停止生成"]'));
  await page.waitForTimeout(500);
}
async function settings(page) {
  await page.getByRole('button',{name:'当前渠道和模型',exact:true}).click();
  await page.getByRole('button',{name:'管理渠道',exact:true}).click();
  await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();
}
(async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  let debugPage;
  try {
    const first=await browser.newContext({locale:'zh-CN',viewport:{width:1280,height:800}});
    await first.addInitScript(({key})=>{
      if(localStorage.getItem('fixture-local-seeded'))return;
      localStorage.setItem('fixture-local-seeded','yes');
      localStorage.setItem('chat-demo:channels:v1',JSON.stringify({version:1,activeId:'browser-channel',channels:[
        {id:'deepseek-official',name:'DeepSeek',protocol:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'',model:'deepseek-flash'},
        {id:'browser-channel',name:'浏览器旧渠道',protocol:'openai',baseUrl:'http://172.18.0.1:19095/v1',apiKey:key,model:'fixture/alpha'},
      ],modelLists:{'browser-channel':['fixture/alpha','fixture/beta','fixture/gamma']}}));
    },{key:localSecret});
    const page=await first.newPage();debugPage=page;page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().includes('/api/chat/proxy/'))requests.push({url:request.url(),headers:request.headers(),body:request.postData()});});
    await page.route('https://api.deepseek.com/**',route=>{errors.push('unexpected real provider request');return route.abort();});
    await page.goto(url,{waitUntil:'networkidle'});
    await page.evaluate(async session=>{
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('chat-demo',11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
          const db=request.result,tx=db.transaction(['sessions','sessionSummaries','files'],'readwrite');
          tx.objectStore('sessions').put(session);tx.objectStore('sessionSummaries').put({id:session.id,title:session.title,createdAt:session.createdAt,updatedAt:session.updatedAt,fileIds:['local-doc']});
          tx.objectStore('files').put({id:'local-doc',blob:new Blob(['original local file ✓'],{type:'text/plain'})});
          tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
        };
      });
    },localSession);
    await login(page,a);
    assert.ok(!(await cloud(page,'/sessions')).body.data.list.some(row=>row.id===localSession.id));
    assert.equal(await page.getByText(localSession.title,{exact:true}).count(),0);
    const cookies=await first.cookies();assert.ok(cookies.find(cookie=>cookie.name==='chat-session')?.httpOnly);
    checks.push('登录使用 HttpOnly Cookie；本地旧记录未自动上传，也不混入云端列表');
    await page.getByRole('button',{name:'开启新对话',exact:true}).first().click();
    await send(page,'浏览器云端对话一');
    let rows=(await cloud(page,'/sessions')).body.data.list;
    const created=rows.find(row=>row.title==='浏览器云端对话一');assert.ok(created);
    await page.reload({waitUntil:'networkidle'});
    await page.getByText('浏览器云端对话一',{exact:true}).first().click();
    await page.getByText('云端中文 ✓ 回复',{exact:true}).waitFor();
    checks.push('中文流式回复保存到服务器，刷新页面后重新读取');
    const second=await browser.newContext({locale:'zh-CN',viewport:{width:1200,height:800}});
    const other=await second.newPage();other.setDefaultTimeout(25000);other.on('pageerror',error=>errors.push(error.message));
    await login(other,a);await other.getByText('浏览器云端对话一',{exact:true}).first().click();
    await other.getByText('云端中文 ✓ 回复',{exact:true}).waitFor();
    await send(other,'第二台设备补充');
    await page.bringToFront();
    await page.getByText('第二台设备补充',{exact:true}).waitFor();
    checks.push('第二个浏览器读取同一账号，新增内容自动同步到已打开的对话');
    await cloud(other,`/sessions/${created.id}/title`,'PATCH',{title:'跨设备重命名'});
    await page.bringToFront();await page.getByText('跨设备重命名',{exact:true}).first().waitFor();
    await send(page,'重命名后继续提问');
    assert.equal((await cloud(page,`/sessions/${created.id}`)).body.data.session.messages.filter(message=>message.role==='user').length,3);
    checks.push('云端重命名同步后继续对话，保存版本正确');
    await settings(page);
    const dialog=page.getByRole('dialog',{name:'设置',exact:true});
    assert.equal(await dialog.getByLabel('API Key',{exact:true}).count(),0);
    assert.equal(await dialog.getByRole('button',{name:'显示',exact:true}).count(),0);
    await dialog.getByRole('button',{name:'更换 API Key',exact:true}).click();
    const field=dialog.getByLabel('API Key',{exact:true});assert.equal(await field.inputValue(),'');
    await field.fill(replacement);await dialog.getByRole('button',{name:'保存并使用',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const metadata=(await cloud(page,'/channels')).body.data;
    assert.ok(metadata.channels.some(channel=>channel.id==='gateway-a'&&channel.hasKey));
    assert.ok(!JSON.stringify(metadata).includes(replacement));
    assert.ok(!await page.evaluate(key=>JSON.stringify(localStorage).includes(key),replacement));
    await settings(page);assert.equal(await dialog.getByLabel('API Key',{exact:true}).count(),0);
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    assert.ok(requests.length>0&&requests.every(request=>!request.headers.authorization&&!request.headers['x-api-key']&&request.headers['x-chat-owner']===String(a.id)));
    checks.push('云端渠道只显示已配置，修改输入为空，已保存密钥不进入浏览器存储和对话请求');
    await page.getByRole('button',{name:'账号与同步',exact:true}).click();
    await page.getByRole('button',{name:'导入本页本地记录',exact:true}).click();
    const migration=page.getByRole('dialog',{name:'迁移浏览器数据',exact:true});
    await migration.getByText('找到 1 个对话、1 个附件',{exact:true}).waitFor();
    assert.ok(!(await cloud(page,'/sessions')).body.data.list.some(row=>row.id===localSession.id));
    await migration.getByRole('button',{name:'确认导入当前账号',exact:true}).click();await migration.waitFor({state:'hidden'});
    assert.ok((await cloud(page,'/sessions')).body.data.list.some(row=>row.id===localSession.id));
    const original=await page.evaluate(async()=>{
      const response=await fetch('/api/chat/files/local-doc');return response.text();
    });assert.equal(original,'original local file ✓');
    assert.equal(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('chat-demo',11);r.onsuccess=()=>{const db=r.result,q=db.transaction('sessions').objectStore('sessions').count();q.onsuccess=()=>{db.close();resolve(q.result)}}})),1);
    checks.push('确认前不迁移，确认后历史、文档原件和渠道入库，浏览器原记录保留');
    await page.getByRole('dialog',{name:'账号与同步',exact:true}).getByRole('button',{name:'退出登录',exact:true}).click();
    await page.getByRole('button',{name:'登录',exact:true}).waitFor();
    await page.getByText(localSession.title,{exact:true}).first().waitFor();
    assert.equal(await page.getByText('跨设备重命名',{exact:true}).count(),0);
    checks.push('退出后恢复原本地记录，旧账号云端内容从页面清除');
    const isolated=await browser.newContext({locale:'zh-CN',viewport:{width:1100,height:800}});
    const isolatedPage=await isolated.newPage();await login(isolatedPage,b);
    assert.equal(await isolatedPage.getByText('跨设备重命名',{exact:true}).count(),0);
    await isolatedPage.getByRole('button',{name:'账号与同步',exact:true}).click();
    assert.equal(await isolatedPage.getByRole('link',{name:'管理后台',exact:true}).count(),0);
    checks.push('另一账号看不到前一个账号的数据，普通用户无管理后台入口');
    await page.screenshot({path:'/home/ubuntu/.cache/chat-demo/account-local-desktop.png'});
    await other.screenshot({path:'/home/ubuntu/.cache/chat-demo/account-cloud-desktop.png'});
    for(const width of [320,390]) {
      const mobile=await browser.newContext({locale:'zh-CN',viewport:{width,height:844},isMobile:true,hasTouch:true});
      const mobilePage=await mobile.newPage();await login(mobilePage,a);
      const dimensions=await mobilePage.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,header:document.querySelector('header').getBoundingClientRect().width}));
      assert.ok(dimensions.scroll<=width+1&&dimensions.header<=width+1);
      await mobilePage.getByRole('button',{name:'账号与同步',exact:true}).click();
      await mobilePage.getByRole('button',{name:'修改密码',exact:true}).waitFor();
      if(width===390)await mobilePage.screenshot({path:'/home/ubuntu/.cache/chat-demo/account-cloud-mobile.png'});
      await mobile.close();
    }
    checks.push('320 和 390 像素手机可登录、打开账号菜单，顶部工具栏无横向溢出');
    assert.deepEqual(errors,[]);
    fs.writeFileSync('/home/ubuntu/.cache/chat-demo/backend-browser-validation.json',JSON.stringify({passed:checks.length,checks,errors},null,2));
    console.log(JSON.stringify({passed:checks.length,checks}));
  }catch(error){if(debugPage)await debugPage.screenshot({path:'/home/ubuntu/.cache/chat-demo/backend-browser-failure.png'}).catch(()=>{});throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
