const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const qaPath = '/home/ubuntu/.cache/chat-demo/backend-qa/qa.json';
const qa = JSON.parse(fs.readFileSync(qaPath));
const base = 'http://127.0.0.1:8093/api/chat';
const checks = [];
const users = [];
const fixtures = ['fixture-key-a', 'fixture-key-b', 'fixture-key-a-replaced'];
const json = value => ({headers:{'Content-Type':'application/json'}, body:JSON.stringify(value)});
async function call(user, endpoint, method='GET', options={}) {
  const headers = new Headers(options.headers);
  if (user) { headers.set('Cookie',user.cookie); headers.set('X-Chat-Owner',String(user.id)); }
  const response = await fetch(base + endpoint, {...options,headers,method});
  const text = await response.text();
  let body; try { body=JSON.parse(text); } catch {}
  return {response,body,text};
}
async function register(label) {
  const username='qa_'+label+'_'+crypto.randomBytes(3).toString('hex');
  const password=crypto.randomBytes(16).toString('hex');
  const result = await call(null,'/auth/register','POST',json({username,password,inviteCode:qa.inviteCode,authorityId:888}));
  assert.equal(result.body.code,0,'register failed'); assert.equal(result.body.data.admin,false,'normal signup gained admin');
  const user={...result.body.data,username,password,cookie:result.response.headers.get('set-cookie').split(';')[0]}; users.push(user); return user;
}
function session(title) {
  const now=Date.now();
  return {id:'shared-session',title,createdAt:now,updatedAt:now,rootMessageId:'q1',messages:[
    {id:'q1',role:'user',createdAt:now,content:'test question',files:[],parentId:null,selectedChildId:'a1'},
    {id:'a1',role:'assistant',createdAt:now,status:'done',blocks:[{type:'text',text:'fixture answer'}],parentId:'q1',selectedChildId:null,model:'fixture/alpha',channelId:'gateway-a',channelProtocol:'openai'},
  ]};
}
function uploadForm(sessions,files=[],replace=false) {
  const form=new FormData(); form.append('sessions',JSON.stringify(sessions)); form.append('replace',String(replace));
  form.append('fileMetadata',JSON.stringify(files.map(file=>({id:file.id,name:file.name,mimeType:file.type}))));
  for(const file of files) form.append('file:'+file.id,new Blob([file.bytes],{type:file.type}),file.name);
  return form;
}
function database(sql) {
  return execFileSync('sudo',['-n','docker','exec','-i','1Panel-postgresql-HptZ','sh','-c',`PGPASSWORD="$POSTGRES_PASSWORD" psql -U "${'${POSTGRES_USER:-postgres}'}" -d '${qa.database}' -v ON_ERROR_STOP=1 -At`],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
}
(async()=>{
  assert.match(qa.database,/^chat_demo_qa_[a-f0-9]{12}$/,'must use isolated QA database');
  assert.equal((await call(null,'/sessions')).response.status,401);
  const invalid=await call(null,'/auth/register','POST',json({username:'qa_bad_invite',password:'fixture-password',inviteCode:'wrong'}));
  assert.equal(invalid.response.status,400); checks.push('认证与邀请码注册，注册固定为普通角色');
  const a=await register('a'), b=await register('b');
  const parallel=await Promise.all(Array.from({length:10},()=>call(a,'/channels')));
  assert.ok(parallel.every(result=>result.body.code===0)); checks.push('首次渠道并发初始化无唯一索引冲突');
  let aSession=session('账号 A'),bSession=session('账号 B');
  assert.equal((await call(a,'/sessions/shared-session','PUT',{...json(aSession),headers:{'Content-Type':'application/json','If-Match':'0'}})).body.data.revision,1);
  assert.equal((await call(b,'/sessions/shared-session')).response.status,404);
  assert.equal((await call(b,'/sessions/shared-session','PUT',{...json(bSession),headers:{'Content-Type':'application/json','If-Match':'0'}})).body.data.revision,1);
  assert.equal((await call(a,'/auth/me','GET',{headers:{'X-Chat-Owner':String(b.id)}})).response.status,200);
  const mismatch=await fetch(base+'/auth/me',{headers:{Cookie:a.cookie,'X-Chat-Owner':String(b.id)}}); assert.equal(mismatch.status,409);
  checks.push('同名会话按账号隔离，账号变化请求拒绝执行');
  const file={id:'qa-file',name:'fixture.txt',type:'text/plain',bytes:Buffer.from('独立附件 original ✓')};
  aSession.messages[0].files=[{id:file.id,serverId:null,name:file.name,mimeType:file.type,size:file.bytes.length,isImage:false}];
  const form=uploadForm([], [file]); form.append('session',JSON.stringify(aSession));
  assert.equal((await call(a,'/sessions/shared-session','PUT',{body:form,headers:{'If-Match':'1'}})).body.data.revision,2);
  const downloaded=await fetch(base+'/files/qa-file',{headers:{Cookie:a.cookie,'X-Chat-Owner':String(a.id)}});
  assert.equal(downloaded.headers.get('content-type'),'application/octet-stream'); assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');
  assert.ok(Buffer.from(await downloaded.arrayBuffer()).equals(file.bytes));
  assert.equal((await call(b,'/files/qa-file')).response.status,404); checks.push('附件原件持久化与账号隔离，下载使用安全 MIME');
  const concurrent=await Promise.all(['设备一','设备二'].map(title=>call(a,'/sessions/shared-session','PUT',{...json({...aSession,title}),headers:{'Content-Type':'application/json','If-Match':'2'}})));
  assert.deepEqual(concurrent.map(row=>row.response.status).sort(),[200,409]); checks.push('两台设备的旧版本写入返回 409，不覆盖新记录');
  assert.equal((await call(a,'/sessions/shared-session/title','PATCH',json({title:'重命名保留附件'}))).body.code,0);
  const renamed=(await call(a,'/sessions/shared-session')).body.data; assert.equal(renamed.revision,4); assert.equal(renamed.session.title,'重命名保留附件');
  const extra={...session('迁移新增'),id:'import-added'};
  assert.equal((await call(a,'/history/import','POST',{body:uploadForm([session('旧版本不得覆盖'),extra])})).body.data.imported,1);
  assert.equal((await call(a,'/sessions/shared-session')).body.data.session.title,'重命名保留附件');
  const corrupt={...extra,messages:[{id:'bad',role:'system'}]};
  assert.equal((await call(a,'/history/import','POST',{body:uploadForm([corrupt],[],true)})).response.status,400);
  assert.equal((await call(a,'/history/import','POST',{body:uploadForm([extra],[{...file,id:'invalid/id'}],true)})).response.status,400);
  assert.equal((await call(a,'/sessions')).body.data.total,2);
  assert.equal((await call(b,'/history/import','POST',{body:uploadForm([{...extra,id:'b-replaced'}],[],true)})).body.data.imported,1);
  assert.equal((await call(b,'/sessions/shared-session')).response.status,404); assert.equal((await call(a,'/sessions')).body.data.total,2);
  checks.push('迁移默认添加、覆盖导入按账号执行，校验失败保留原历史');
  let channel={id:'gateway-a',name:'QA 渠道',protocol:'openai',baseUrl:'http://172.18.0.1:19095/v1',model:'fixture/alpha',apiKey:fixtures[0]};
  let saved=await call(a,'/channels/gateway-a','PUT',json(channel)); assert.equal(saved.body.code,0); assert.equal(saved.body.data.hasKey,true);
  assert.ok(!saved.text.includes(fixtures[0])&&!('apiKey' in saved.body.data));
  assert.equal((await call(a,'/channels/models','POST',json({...channel,apiKey:''}))).body.data.length,3);
  channel={...channel,apiKey:''}; assert.equal((await call(a,'/channels/gateway-a','PUT',json(channel))).body.data.hasKey,true);
  channel={...channel,apiKey:fixtures[2]}; assert.equal((await call(a,'/channels/gateway-a','PUT',json(channel))).body.data.hasKey,true);
  const stream=await call(a,'/proxy/gateway-a?path=chat%2Fcompletions','POST',json({model:'fixture/alpha',messages:[{role:'user',content:'redact'}],stream:true}));
  assert.equal(stream.response.status,200); assert.ok(stream.text.includes('中文 ✓')); assert.ok(stream.text.includes('reasoning_content')); assert.ok(stream.text.includes('[DONE]'));
  assert.ok(!stream.text.includes(fixtures[2])); assert.ok(!stream.response.headers.get('x-request-id').includes(fixtures[2]));
  const error=await call(a,'/proxy/gateway-a?path=%2Fchat%2Fcompletions','POST',json({model:'fixture/alpha',messages:[{role:'user',content:'gateway-error'}],stream:true}));
  assert.equal(error.response.status,402); assert.ok(!error.text.includes(fixtures[2])); assert.ok(error.text.includes('[redacted]'));
  assert.equal((await call(b,'/proxy/gateway-a?path=models')).response.status,404);
  assert.equal((await call(a,'/proxy/gateway-a?path=https%3A%2F%2Fexample.com%2Fmodels')).response.status,403);
  assert.equal((await call(a,'/proxy/gateway-a?path=anthropic%2Fv1%2Ffiles','POST',json({}))).response.status,403);
  checks.push('密钥保留、更换、跨账号限制，SSE 中文和思考完整，正文、错误及响应头脱敏');
  const cipher=database(`SELECT key_cipher FROM chat_channels WHERE owner_id=${a.id} AND resource_id='gateway-a';`);
  assert.ok(cipher.startsWith('v1:')&&!cipher.includes(fixtures[2]));
  const role=database(`SELECT authority_id FROM sys_users WHERE id IN (${a.id},${b.id}) ORDER BY id;`); assert.deepEqual(role.split('\n'),['1111','1111']);
  checks.push('实际 PostgreSQL 仅保存密文，账号角色无越权');
  const logoutCookie=b.cookie; assert.equal((await call(b,'/auth/logout','POST',json({}))).body.code,0);
  assert.equal((await call({...b,cookie:logoutCookie},'/auth/me')).response.status,401);
  const oldCookie=a.cookie, originalPassword=a.password, nextPassword=crypto.randomBytes(16).toString('hex');
  const changed=await call(a,'/auth/password','POST',json({oldPassword:originalPassword,newPassword:nextPassword}));
  assert.equal(changed.body.code,0); a.password=nextPassword; a.cookie=changed.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call({...a,cookie:oldCookie},'/auth/me')).response.status,401);
  assert.equal((await call(a,'/auth/me')).body.code,0);
  checks.push('修改密码旋转 Cookie，所有旧聊天会话失效');
  execFileSync('sudo',['-n','docker','restart','chat-demo-backend-qa'],{stdio:'ignore'});
  for(let attempt=0;attempt<30;attempt++) {
    try { if((await call(a,'/auth/me')).response.ok) break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal((await call({...b,cookie:logoutCookie},'/auth/me')).response.status,401);
  assert.equal((await call({...a,cookie:oldCookie},'/auth/me')).response.status,401);
  assert.equal((await call(a,'/sessions')).body.data.total,2);
  assert.equal((await call(a,'/files/qa-file')).response.status,200);
  checks.push('服务重启后对话、附件、退出撤销和改密仍持久生效');
  qa.testUsers=users; fs.writeFileSync(qaPath,JSON.stringify(qa,null,2),{mode:0o600});
  console.log(JSON.stringify({passed:checks.length,checks}));
})().catch(error=>{ console.error(error.stack); process.exitCode=1; });
