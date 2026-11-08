const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {handler}=require('../netlify/functions/google-calendar');
test('persistent authorization binds accounts, encrypts credentials and refreshes only on server',async()=>{
  const saved={...process.env},original=global.fetch;
  Object.assign(process.env,{FIREBASE_API_KEY:'firebase-test',GOOGLE_CALENDAR_CLIENT_ID:'client',GOOGLE_CALENDAR_CLIENT_SECRET:'secret',GOOGLE_CALENDAR_COOKIE_KEY:'ab'.repeat(32)});
  let uid='owner',refreshes=0,reads=0;
  global.fetch=async(url,options)=>{
    const u=String(url);
    if(u.includes('identitytoolkit'))return {ok:true,json:async()=>({users:[{localId:uid,email:'owner@example.com',providerUserInfo:[{providerId:'google.com',rawId:'google-owner'}]}]})};
    if(u.includes('oauth2.googleapis.com/token')){const params=new URLSearchParams(options.body);if(params.get('grant_type')==='refresh_token'){refreshes++;assert.equal(params.get('refresh_token'),'private-refresh');return {ok:true,json:async()=>({access_token:'new-access',expires_in:3600})};}return {ok:true,json:async()=>({refresh_token:'private-refresh',access_token:'old-access',expires_in:1,scope:'https://www.googleapis.com/auth/calendar.readonly'})};}
    if(u.includes('/userinfo'))return {ok:true,json:async()=>({sub:'google-owner'})};
    assert.equal(u,'https://www.googleapis.com/calendar/v3/colors');assert.equal(options.headers.Authorization,'Bearer new-access');reads++;return {ok:true,json:async()=>({event:{}})};
  };
  const event=(action,cookie='',body={})=>({httpMethod:'POST',headers:{authorization:'Bearer firebase-token',origin:'https://pesonaltraine.netlify.app',cookie},queryStringParameters:{action},body:JSON.stringify(body)});
  try{
    assert.equal((await handler({...event('status'),headers:{}})).statusCode,401);
    assert.equal((await handler({...event('start'),headers:{origin:'https://other.example'}})).statusCode,403);
    const start=await handler(event('start')),url=new URL(JSON.parse(start.body).url);
    assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    const stateCookie=start.multiValueHeaders['Set-Cookie'][0];assert.match(stateCookie,/HttpOnly; Secure; SameSite=Lax/);assert.ok(!stateCookie.includes('owner'));
    const callback={httpMethod:'GET',headers:{cookie:stateCookie.split(';')[0]},queryStringParameters:{action:'callback',state:url.searchParams.get('state'),code:'code'}};
    assert.equal((await handler({...callback,queryStringParameters:{...callback.queryStringParameters,state:'wrong'}})).statusCode,400);
    const linked=await handler(callback);assert.match(linked.headers.Location,/calendar=connected$/);
    assert.ok(!JSON.stringify(linked).includes('private-refresh'));assert.ok(!JSON.stringify(linked).includes('old-access'));
    const session=linked.multiValueHeaders['Set-Cookie'][1].split(';')[0];
    assert.equal(JSON.parse((await handler(event('status',session))).body).connected,true);
    uid='other';assert.equal((await handler(event('read',session,{path:'colors'}))).statusCode,401);uid='owner';
    for(const path of ['calendars/a?x=/events','calendars/a/../events','https://evil.example','calendars/a#b/events'])assert.equal((await handler(event('read',session,{path}))).statusCode,400);
    assert.equal((await handler(event('read',session,{path:'colors'}))).statusCode,200);assert.equal(refreshes,1);assert.equal(reads,1);
    assert.match((await handler(event('disconnect',session))).multiValueHeaders['Set-Cookie'][0],/Max-Age=0/);
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    assert.deepEqual(JSON.parse((await handler(event('status'))).body),{configured:false,connected:false});
  }finally{global.fetch=original;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('reload restores valid temporary access, rejects another user and restores server session',async()=>{
  for(const kind of ['valid','other','expired','server']){
    let value=JSON.stringify({uid:kind==='other'?'other':'owner',token:'temporary',expires:Date.now()+(kind==='expired'?-1:300000)}),loads=0;
    const c=vm.createContext({URL,Date,AbortSignal,currentUser:{uid:'owner',getIdToken:async()=>'firebase'},gc:{uid:'owner'},sessionStorage:{getItem:()=>value,removeItem:()=>value=null,setItem:(_,v)=>value=v},fetch:async()=>({ok:true,json:async()=>({configured:kind==='server',connected:kind==='server'})}),window:{location:{href:'https://pesonaltraine.netlify.app/'}},history:{replaceState(){}},gcRender(){},gcLoad(){loads++;}});
    vm.runInContext(fs.readFileSync(require.resolve('../google-connection.js'),'utf8'),c);await c.gcRestoreConnection(c.currentUser);
    assert.equal(loads,kind==='valid'||kind==='server'?1:0);
    if(kind==='server'){assert.equal(c.gc.mode,'server');assert.equal(c.gc.token,'server-session');assert.equal(value,null);}
  }
});
