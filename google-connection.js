/* Durable Google authorization lives only in a server-encrypted HttpOnly cookie. */
async function gcServer(action,payload={},user=currentUser){
  if(!user)throw Error('יש להיכנס לחשבון.');
  const token=await user.getIdToken();
  const response=await fetch('/.netlify/functions/google-calendar?action='+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
  const result=await response.json();
  if(!response.ok){const error=Error(result.error||'לא ניתן להתחבר ליומן.');error.auth=!!result.reconnect;throw error;}
  return result;
}
function gcRememberBrowser(){
  // Temporary fallback while server credentials are being configured. Never a refresh token.
  try{sessionStorage.setItem('myway-calendar-access',JSON.stringify({uid:gc.uid,token:gc.token,expires:gc.expires}));}catch{}
}
async function gcRestoreConnection(user){
  if(!user||gc.restoreStarted)return;
  gc.restoreStarted=true;const uid=user.uid;
  try{
    const cached=JSON.parse(sessionStorage.getItem('myway-calendar-access')||'null');
    if(cached?.uid===uid&&typeof cached.token==='string'&&cached.expires>Date.now()+60000){gc.token=cached.token;gc.expires=cached.expires;gc.mode='browser';}
    else sessionStorage.removeItem('myway-calendar-access');
  }catch{}
  try{
    const result=await gcServer('status',{},user);
    if(currentUser?.uid!==uid||gc.uid!==uid)return;
    gc.serverConfigured=result.configured===true;
    if(result.connected){gc.mode='server';gc.token='server-session';gc.expires=Infinity;sessionStorage.removeItem('myway-calendar-access');}
  }catch{/* An unavailable status service must not erase a still-valid in-tab connection. */}
  if(currentUser?.uid===uid&&gc.uid===uid){
    const location=new URL(window.location.href),outcome=location.searchParams.get('calendar');
    const errors={denied:'חיבור היומן בוטל. אפשר לנסות שוב.',permission:'יש לאשר הרשאת קריאה ליומן בחיבור Google.',account:'יש לבחור את חשבון Google שאיתו נכנסת ל־My Way.',failed:'לא ניתן להשלים את חיבור Google. נסה שוב.'};
    if(outcome){location.searchParams.delete('calendar');history.replaceState(null,'',location.href);if(errors[outcome])gc.error=errors[outcome];}
    gcRender();if(gc.token&&!gc.loading)gcLoad();
  }
}
async function gcStartPersistent(){
  const user=currentUser;if(!user)return;
  const result=await gcServer('start',{},user);
  if(currentUser?.uid!==user.uid)return;
  const url=new URL(result.url);
  if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error('כתובת חיבור לא תקינה.');
  window.location.assign(url.href);
}
