#!/usr/bin/env python3
"""Update Chat API docs without loading the full Go dependency graph on production."""
from pathlib import Path
import json
import yaml

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'server/docs'
document=json.loads((DOCS/'swagger.json').read_text())
definitions=document.setdefault('definitions',{})
response={'$ref':'#/definitions/response.Response'}
definitions['chat.Login']={'type':'object','required':['username','password'],'properties':{'username':{'type':'string'},'password':{'type':'string','format':'password'}}}
definitions['chat.Register']={'type':'object','required':['username','password','inviteCode'],'properties':{'username':{'type':'string','minLength':3,'maxLength':32},'password':{'type':'string','minLength':8,'format':'password'},'nickname':{'type':'string'},'inviteCode':{'type':'string'}}}
definitions['chat.Password']={'type':'object','required':['oldPassword','newPassword'],'properties':{'oldPassword':{'type':'string','format':'password'},'newPassword':{'type':'string','minLength':8,'format':'password'}}}
definitions['chat.Channel']={'type':'object','properties':{'id':{'type':'string'},'name':{'type':'string'},'protocol':{'type':'string','enum':['deepseek','openai']},'baseUrl':{'type':'string'},'model':{'type':'string'},'apiKey':{'type':'string','format':'password','description':'新密钥；未提供或留空保留旧值，不从服务器回显'},'clearKey':{'type':'boolean'},'models':{'type':'array','items':{'type':'string'}}}}
definitions['chat.Session']={'type':'object','required':['id','messages'],'properties':{'id':{'type':'string'},'title':{'type':'string'},'createdAt':{'type':'integer','format':'int64'},'updatedAt':{'type':'integer','format':'int64'},'messages':{'type':'array','items':{'type':'object','additionalProperties':True}},'rootMessageId':{'type':'string'}}}
document.setdefault('securityDefinitions',{})['ChatSessionAuth']={'type':'apiKey','name':'Cookie','in':'header','description':'HttpOnly chat-session Cookie；Swagger 2.0 使用 Cookie header 表示。'}

def body(model): return {'name':'data','in':'body','required':True,'schema':{'$ref':'#/definitions/chat.'+model}}
def path_id(): return {'name':'id','in':'path','required':True,'type':'string'}
def operation(method,path,title,parameters=None,public=False,description=''):
    value={'tags':['ChatAuth' if path.startswith('/chat/auth') or path=='/chat/status' else 'ChatChannels' if '/channels' in path or '/proxy/' in path else 'ChatStorage'],
           'summary':title,'produces':['application/json'],'responses':{'200':{'description':'成功','schema':response},'400':{'description':'请求参数无效','schema':response}}}
    params=list(parameters or [])
    if not public:
        value['security']=[{'ChatSessionAuth':[]}]
        params.append({'name':'X-Chat-Owner','in':'header','required':False,'type':'integer','description':'发起请求时的账号ID，变化时拒绝执行'})
        value['responses'].update({'401':{'description':'需要登录','schema':response},'409':{'description':'账号变化或会话版本冲突','schema':response}})
    if params: value['parameters']=params
    if description: value['description']=description
    if method in ['post','put','patch']: value['consumes']=['application/json']
    document.setdefault('paths',{}).setdefault(path,{})[method]=value
    return value

operation('get','/chat/status','获取后端能力与安全登录来源',public=True)
operation('post','/chat/auth/login','登录并设置 HttpOnly Cookie',[body('Login')],True)
operation('post','/chat/auth/register','通过邀请码注册普通聊天账号',[body('Register')],True)
operation('get','/chat/auth/me','获取当前账号')
operation('post','/chat/auth/logout','退出并持久撤销当前登录令牌')
operation('post','/chat/auth/password','修改密码并使旧聊天会话失效',[body('Password')])
operation('get','/chat/sessions','获取账号下的会话摘要与版本')
operation('get','/chat/sessions/{id}','获取自己的会话与版本',[path_id()])
saved=operation('put','/chat/sessions/{id}','保存自己的会话与附件',[path_id(),{'name':'If-Match','in':'header','required':True,'type':'string','description':'上次读取的版本，新会话为0'},body('Session')],description='也接受 multipart/form-data：session 为 JSON，fileMetadata 为 [{id,name,mimeType}]，每个原件字段为 file:<id>。')
saved['consumes']=['application/json','multipart/form-data']
operation('patch','/chat/sessions/{id}/title','修改自己的会话标题',[path_id(),{'name':'data','in':'body','required':True,'schema':{'type':'object','properties':{'title':{'type':'string'}}}}])
operation('delete','/chat/sessions/{id}','删除自己的会话与无引用附件',[path_id()])
download=operation('get','/chat/files/{id}','下载自己的附件原件',[path_id()])
download['produces']=['application/octet-stream']; download['responses']['200']={'description':'安全附件下载，Content-Disposition: attachment','schema':{'type':'file'}}
for endpoint,summary in [('/chat/files','上传自己的附件原件'),('/chat/history/import','迁移或覆盖导入自己的历史')]:
    params=[{'name':'fileMetadata','in':'formData','required':False,'type':'string','description':'[{id,name,mimeType}]；每个原件字段名称为 file:<id>'}]
    if 'import' in endpoint:
        params.extend([{'name':'sessions','in':'formData','required':True,'type':'string','description':'现有会话格式的 JSON 数组'},{'name':'replace','in':'formData','required':False,'type':'boolean','description':'true 在事务中替换该账号历史；默认仅添加缺少的ID'}])
    entry=operation('post',endpoint,summary,params,description='动态文件字段为 file:<id>，ID 与 fileMetadata 中的 ID 一致；仅当前账号可访问原件。')
    entry['consumes']=['multipart/form-data']
operation('get','/chat/channels','获取渠道元数据和模型缓存，密钥及密文不返回')
operation('put','/chat/channels/{id}','保存渠道或替换密钥',[path_id(),body('Channel')])
operation('delete','/chat/channels/{id}','删除自定义渠道',[path_id()])
operation('post','/chat/channels/active','选择自己的渠道',[{'name':'data','in':'body','required':True,'schema':{'type':'object','properties':{'id':{'type':'string'}}}}])
operation('post','/chat/channels/models','使用临时或保存的密钥获取模型列表',[body('Channel')])
operation('put','/chat/channels/{id}/models','缓存自己的渠道模型列表',[path_id(),{'name':'data','in':'body','required':True,'schema':{'type':'object','properties':{'models':{'type':'array','items':{'type':'string'}}}}}])
for method in ['get','post','delete']:
    entry=operation(method,'/chat/proxy/{id}','转发模型、附件或语音请求',[path_id(),{'name':'path','in':'query','required':True,'type':'string','description':'允许的服务相对路径，如 chat/completions 或 anthropic/v1/files'}],description='只允许支持的模型服务接口，使用当前账号的加密密钥；响应保持原始 SSE、JSON 或二进制，不套统一 JSON 信封。')
    entry['produces']=['text/event-stream','application/json','application/octet-stream']
    entry['responses']['200']={'description':'模型原始响应，支持取消与 SSE flush','schema':{'type':'string'}}
    if method=='post': entry['consumes']=['application/json','multipart/form-data']

(DOCS/'swagger.json').write_text(json.dumps(document,indent=4,ensure_ascii=False)+'\n')
(DOCS/'swagger.yaml').write_text(yaml.safe_dump(document,allow_unicode=True,sort_keys=False))
template=json.loads(json.dumps(document))
template.update({'schemes':['__CHAT_SCHEMES__'],'host':'{{.Host}}','basePath':'{{.BasePath}}'})
template['info'].update({'title':'{{.Title}}','description':'{{escape .Description}}','version':'{{.Version}}'})
raw=json.dumps(template,indent=4,ensure_ascii=False).replace('[\n        "__CHAT_SCHEMES__"\n    ]','{{ marshal .Schemes }}').replace('`','\\u0060')
source=(DOCS/'docs.go').read_text()
start=source.index('const docTemplate = '); end=source.index('// SwaggerInfo',start)
(DOCS/'docs.go').write_text(source[:start]+'const docTemplate = `'+raw+'`\n\n'+source[end:])
print('Chat Swagger updated with Python; the full Go dependency graph was not loaded.')
