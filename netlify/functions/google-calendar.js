const crypto=require('node:crypto');
const ORIGIN='https://pesonaltraine.netlify.app';
const PATH='/.netlify/functions/google-calendar';
const SESSION='myway_gcal';const STATE='myway_gcal_state';
const TTL=180*86400;
function configured(){return !!(process.env.GOOGLE_CALENDAR_CLIENT_ID&&process.env.GOOGLE_CALENDAR_CLIENT_SECRET&&/^[a-f0-9]{64}$/i.test(process.env.GOOGLE_CALENDAR_COOKIE_KEY||''));}
function seal(data){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.GOOGLE_CALENDAR_COOKIE_KEY,'hex'),iv);cipher.setAAD(Buffer.from('myway-calendar-v1'));const bytes=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');}
function unseal(value){try{const b=Buffer.from(value||'','base64url');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.GOOGLE_CALENDAR_COOKIE_KEY,'hex'),b.subarray(0,12));d.setAAD(Buffer.from('myway-calendar-v1'));d.setAuthTag(b.subarray(12,28));const data=JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));return data.until>Date.now()?data:null;}catch{return null;}}
function cookies(event){return Object.fromEntries((event.headers?.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(p=>p.length===2));}
function cookie(name,value,maxAge){return `${name}=${value}; Path=${PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;}
function reply(code,data,set=[]){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},...(set.length?{multiValueHeaders:{'Set-Cookie':set}}:{}),body:JSON.stringify(data)};}
function redirect(result,set=[]){const r=reply(302,{},set);r.headers.Location=ORIGIN+'/?calendar='+result;return r;}
async function request(url,options={}){return fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}
async function identity(event){
  const token=(event.headers?.authorization||event.headers?.Authorization||'').replace(/^Bearer /,'');
  if(!token||!process.env.FIREBASE_API_KEY)return null;
  const res=await request('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(process.env.FIREBASE_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
  if(!res.ok)return null;const data=await res.json();return data.users?.[0]||null;
}
async function googleToken(fields){
  return request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CALENDAR_CLIENT_ID,client_secret:process.env.GOOGLE_CALENDAR_CLIENT_SECRET,...fields}).toString()});
}
exports.handler=async event=>{
  const action=event.queryStringParameters?.action||'status';
  if(!['start','callback','status','disconnect','read'].includes(action))return reply(400,{error:'Invalid action'});
  if(action==='callback'){
    if(event.httpMethod!=='GET'||!configured())return reply(400,{error:'Connection not configured'});
    const state=unseal(cookies(event)[STATE]);const query=event.queryStringParameters||{};
    if(!state||!query.state||state.state!==query.state)return reply(400,{error:'הבקשה לחיבור פגה. יש להתחיל שוב מהאפליקציה.'});
    const clear=cookie(STATE,'',0);
    if(query.error||!query.code)return redirect('denied',[clear]);
    try{
      const tokenResponse=await googleToken({grant_type:'authorization_code',code:query.code,redirect_uri:ORIGIN+PATH+'?action=callback',code_verifier:state.verifier});
      if(!tokenResponse.ok)return redirect('failed',[clear]);
      const tokens=await tokenResponse.json();
      if(!tokens.refresh_token||!tokens.access_token||!String(tokens.scope||'').split(' ').includes('https://www.googleapis.com/auth/calendar.readonly'))return redirect('permission',[clear]);
      const who=await request('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}});
      if(!who.ok)return redirect('failed',[clear]);const account=await who.json();
      if(account.sub!==state.googleSub)return redirect('account',[clear]);
      const seconds=Math.min(TTL,Number(tokens.refresh_token_expires_in)||TTL);
      const session={uid:state.uid,refresh:tokens.refresh_token,access:tokens.access_token,expires:Date.now()+Number(tokens.expires_in||3600)*1000-60000,until:Date.now()+seconds*1000};
      return redirect('connected',[clear,cookie(SESSION,seal(session),seconds)]);
    }catch{return redirect('failed',[clear]);}
  }
  if(event.httpMethod!=='POST')return reply(405,{error:'Method not allowed'});
  if(event.headers?.origin&&event.headers.origin!==ORIGIN)return reply(403,{error:'Origin not allowed'});
  try{
    const user=await identity(event);if(!user)return reply(401,{error:'יש להיכנס שוב ל־My Way.'});
    if(action==='disconnect')return reply(200,{connected:false},[cookie(SESSION,'',0),cookie(STATE,'',0)]);
    if(!configured())return action==='status'?reply(200,{configured:false,connected:false}):reply(503,{error:'יש להשלים את הגדרות חיבור Google בשרת.'});
    let session=unseal(cookies(event)[SESSION]);if(session?.uid!==user.localId)session=null;
    if(action==='status')return reply(200,{configured:true,connected:!!session});
    if(action==='start'){
      const googleSub=user.providerUserInfo?.find(p=>p.providerId==='google.com')?.rawId;
      if(!googleSub)return reply(400,{error:'יש להיכנס ל־My Way באמצעות חשבון Google לפני חיבור היומן.'});
      const state=crypto.randomBytes(24).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      const params={client_id:process.env.GOOGLE_CALENDAR_CLIENT_ID,redirect_uri:ORIGIN+PATH+'?action=callback',response_type:'code',scope:'openid email https://www.googleapis.com/auth/calendar.readonly',access_type:'offline',prompt:'consent',include_granted_scopes:'true',state,login_hint:user.email||'',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'};
      Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
      return reply(200,{url:url.href},[cookie(STATE,seal({state,verifier,uid:user.localId,googleSub,until:Date.now()+10*60000}),600)]);
    }
    if(!session)return reply(401,{reconnect:true,error:'נדרש חיבור מחדש ל־Google.'});
    let body;try{body=JSON.parse(event.body||'{}');}catch{return reply(400,{error:'Invalid request'});}
    if(!body||!['colors','users/me/calendarList'].includes(body.path)&&!/^calendars\/[A-Za-z0-9@._%+-]+\/events$/.test(body.path||''))return reply(400,{error:'Invalid calendar path'});
    const allowed=new Set(['maxResults','minAccessRole','pageToken','timeMin','timeMax','timeZone','singleEvents','orderBy']);
    const url=new URL('https://www.googleapis.com/calendar/v3/'+body.path);
    if(url.origin!=='https://www.googleapis.com')return reply(400,{error:'Invalid path'});
    for(const [key,value]of Object.entries(body.params||{})){if(!allowed.has(key)||typeof value==='object')return reply(400,{error:'Invalid parameters'});url.searchParams.set(key,String(value));}
    const updates=[];
    if(session.expires<=Date.now()){
      const refreshed=await googleToken({grant_type:'refresh_token',refresh_token:session.refresh});
      if(!refreshed.ok){let data={};try{data=await refreshed.json();}catch{}
        if(data.error==='invalid_grant')return reply(401,{reconnect:true,error:'Google ביטלה או סיימה את תוקף ההרשאה. יש להתחבר מחדש.'},[cookie(SESSION,'',0)]);
        return reply(503,{error:'Google אינה זמינה כרגע. נסה שוב מאוחר יותר.'});
      }
      const data=await refreshed.json();if(!data.access_token)return reply(502,{error:'לא התקבלה הרשאה תקינה מ־Google.'});
      session={...session,access:data.access_token,refresh:data.refresh_token||session.refresh,expires:Date.now()+Number(data.expires_in||3600)*1000-60000};
      updates.push(cookie(SESSION,seal(session),Math.max(0,Math.floor((session.until-Date.now())/1000))));
    }
    const res=await request(url.href,{headers:{Authorization:'Bearer '+session.access}});
    if(!res.ok)return reply(res.status===401?401:res.status===403?403:502,{reconnect:res.status===401,error:res.status===403?'Google לא מאפשרת קריאה. יש לבדוק הרשאות והפעלת Google Calendar API.':'לא ניתן לקבל נתונים מ־Google כרגע.'},updates);
    return reply(200,{data:await res.json()},updates);
  }catch{return reply(503,{error:'החיבור ליומן אינו זמין כרגע. נסה שוב.'});}
};
