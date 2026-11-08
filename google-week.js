/* Read-only calendar. Persistent credentials stay in a server-encrypted HttpOnly cookie. */
const GC_ZONE='Asia/Jerusalem';
let gc={uid:null,token:null,expires:0,week:null,calendars:[],events:[],loading:false,connecting:false,error:'',warnings:[],fetchedAt:null,request:0};
function gcDay(value=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:GC_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');}
function gcAdd(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function gcSunday(date){return gcAdd(date,-new Date(date+'T12:00:00Z').getUTCDay());}
function gcMidnight(date){
  const target=Date.parse(date+'T00:00:00Z');let instant=target;
  for(let i=0;i<3;i++){
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:GC_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
    const get=k=>p.find(x=>x.type===k).value;
    const wall=Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
    instant+=target-wall;
  }
  return new Date(instant).toISOString();
}
function gcSafeUrl(url){try{const u=new URL(url);return u.protocol==='https:'&&['calendar.google.com','www.google.com'].includes(u.hostname)?u.href:null;}catch{return null;}}
function gcEventDays(event,week){
  if(event.status==='cancelled')return [];
  const allDay=!!event.start?.date;const start=allDay?event.start.date:event.start?.dateTime;const end=allDay?event.end?.date:event.end?.dateTime;
  if(!start||!end)return [];
  const result=[];
  for(let i=0;i<7;i++){const day=gcAdd(week,i),next=gcAdd(day,1);if(allDay?(start<next&&end>day):(Date.parse(start)<Date.parse(gcMidnight(next))&&Date.parse(end)>Date.parse(gcMidnight(day))))result.push(day);}
  return result;
}
function gcAuthChanged(user){
  if(gc.uid===(user?.uid||null))return;
  gc={uid:user?.uid||null,token:null,expires:0,week:gcSunday(gcDay()),calendars:[],events:[],loading:false,connecting:false,error:'',warnings:[],fetchedAt:null,request:gc.request+1};
  for(const id of ['google-week','google-today']){const el=document.getElementById(id);if(el)el.replaceChildren();}
  if(user&&typeof gcRestoreConnection==='function')gcRestoreConnection(user);
}
async function gcConnect(){
  if(!currentUser||gc.connecting)return;
  const user=currentUser;gcAuthChanged(user);gc.connecting=true;gc.error='';gcRender();
  try{
    if(typeof gcServer==='function'){
      let status={};try{status=await gcServer('status',{},user);}catch{}
      if(currentUser?.uid!==user.uid)return;
      gc.serverConfigured=status.configured===true;
      if(gc.serverConfigured){await gcStartPersistent();return;}
    }
    const provider=new firebase.auth.GoogleAuthProvider();provider.addScope('https://www.googleapis.com/auth/calendar.readonly');provider.setCustomParameters({login_hint:user.email||'',prompt:'consent'});
    const result=await user.reauthenticateWithPopup(provider);
    if(currentUser?.uid!==user.uid)return;
    if(!result.credential?.accessToken)throw Error('לא התקבלה הרשאת קריאה ליומן.');
    gc.token=result.credential.accessToken;gc.expires=Date.now()+50*60*1000;gc.calendars=[];gc.events=[];
    gc.mode='browser';if(typeof gcRememberBrowser==='function')gcRememberBrowser();
    await gcLoad();
  }catch(error){if(currentUser?.uid===user.uid)gc.error=error.code==='auth/popup-closed-by-user'?'החיבור בוטל. אפשר לנסות שוב.':error.code==='auth/user-mismatch'?'יש לבחור את חשבון Google שאיתו נכנסת ל־My Way.':error.code==='auth/popup-blocked'?'הדפדפן חסם את חלון החיבור. אפשר חלונות קופצים ונסה שוב.':'לא ניתן להשלים את החיבור. ודא ש־Google Calendar API מופעל והרשאת היומן מאושרת בפרויקט Google של האפליקציה.';}
  finally{gc.connecting=false;gcRender();}
}
async function gcRead(path,params,token){
  if(gc.mode==='server'){const result=await gcServer('read',{path,params});return result.data;}
  const url=new URL('https://www.googleapis.com/calendar/v3/'+path);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const response=await fetch(url.href,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(response.status===401){const e=Error('החיבור ל־Google פג. התחבר שוב להצגת היומן.');e.auth=true;throw e;}
  if(!response.ok)throw Error(response.status===403?'Google לא מאפשרת קריאה מהיומן. יש לבדוק הרשאות והפעלת Google Calendar API.':'לא ניתן לקרוא את היומן כרגע. נסה לרענן.');
  return response.json();
}
async function gcPages(path,params,token){let items=[],pageToken;do{const data=await gcRead(path,{...params,...(pageToken?{pageToken}:{})},token);items.push(...(data.items||[]));pageToken=data.nextPageToken;}while(pageToken);return items;}
async function gcLoad(){
  if(!currentUser||gc.loading)return;
  if(!gc.token||(gc.mode!=='server'&&gc.expires<=Date.now())){gc.token=null;gc.events=[];gc.fetchedAt=null;gc.error='התחבר ל־Google כדי להציג את השבוע.';gcRender();return;}
  const uid=currentUser.uid,token=gc.token,week=gc.week||gcSunday(gcDay()),request=++gc.request;
  gc.loading=true;gc.error='';gc.warnings=[];gc.events=[];gc.fetchedAt=null;gcRender();
  try{
    let colorWarning='';
    if(!gc.colors){try{
      const colors=await gcRead('colors',{},token);
      if(currentUser?.uid!==uid||gc.request!==request)return;
      gc.colors=colors;
    }catch(error){if(error.auth)throw error;colorWarning='צבעי האירועים לא התקבלו; מוצגים צבעי היומנים.';}}
    if(!gc.calendars.length){
      const calendars=await gcPages('users/me/calendarList',{maxResults:250,minAccessRole:'reader'},token);
      if(currentUser?.uid!==uid||gc.request!==request)return;
      gc.calendars=calendars.filter(c=>!c.deleted).map(c=>({...c,show:c.primary||c.selected===true}));
    }
    const calendars=gc.calendars.filter(c=>c.show);
    const results=await Promise.all(calendars.map(async c=>{try{
      const events=await gcPages('calendars/'+encodeURIComponent(c.id)+'/events',{timeMin:gcMidnight(week),timeMax:gcMidnight(gcAdd(week,7)),timeZone:GC_ZONE,singleEvents:true,orderBy:'startTime',maxResults:250},token);
      return {events:events.filter(e=>e.status!=='cancelled').map(e=>({...e,calendarId:c.id,calendarName:c.summaryOverride||c.summary||'יומן',calendarColor:/^#[0-9a-f]{6}$/i.test(c.backgroundColor||'')?c.backgroundColor:'#9de5d3',eventColor:gcHex(gc.colors?.event?.[e.colorId]?.background)||gcHex(c.backgroundColor)||gcHex(gc.colors?.calendar?.[c.colorId]?.background)||'#9de5d3'}))};
    }catch(error){return {error,calendar:c.summaryOverride||c.summary||'יומן'};}}));
    if(currentUser?.uid!==uid||gc.request!==request)return;
    if(results.some(r=>r.error?.auth)){gc.token=null;gc.events=[];gc.error='החיבור פג. התחבר שוב ל־Google.';return;}
    gc.events=results.flatMap(r=>r.events||[]);gc.warnings=[...(colorWarning?[colorWarning]:[]),...results.filter(r=>r.error).map(r=>'לא ניתן לקרוא את '+r.calendar+'.')];gc.fetchedAt=new Date().toISOString();
    if(!gc.weeks)gc.weeks={};gc.weeks[week]={events:gc.events,warnings:gc.warnings,fetchedAt:gc.fetchedAt};
  }catch(error){if(currentUser?.uid===uid&&gc.request===request){if(error.auth)gc.token=null;gc.error=error.message;}}
  finally{if(currentUser?.uid===uid&&gc.request===request){gc.loading=false;gcRender();}}
}
function gcMove(delta){if(gc.loading)return;gc.week=gcAdd(gc.week||gcSunday(gcDay()),delta*7);gcLoad();}
function gcThisWeek(){if(gc.loading)return;gc.week=gcSunday(gcDay());gcLoad();}
function gcToggle(index,checked){if(gc.loading||!gc.calendars[index])return;gc.calendars[index].show=checked;gc.weeks={};gcLoad();}
async function gcDisconnect(){
  if(gc.mode==='server'){try{await gcServer('disconnect');}catch(error){gc.error=error.message;gcRender();return;}}
  try{sessionStorage.removeItem('myway-calendar-access');}catch{}
  gc.token=null;gc.expires=0;gc.events=[];gc.calendars=[];gc.weeks={};gc.error='';gc.fetchedAt=null;gc.request++;gc.loading=false;gcRender();
}
function gcTime(value){return new Date(value).toLocaleTimeString('he-IL',{timeZone:GC_ZONE,hour:'2-digit',minute:'2-digit'});}
function gcRender(){
  gcRenderToday();
  const el=document.getElementById('google-week');if(!el)return;
  if(!currentUser){el.textContent='יש להיכנס לחשבון כדי להציג את היומן.';return;}
  if(gc.uid!==currentUser.uid)gcAuthChanged(currentUser);
  if(!gc.week)gc.week=gcSunday(gcDay());
  const week=gc.week,today=gcDay(),connected=!!gc.token&&gc.expires>Date.now();
  let h='<section class="gc-overview" aria-labelledby="gc-title"><div class="gc-top"><div><div class="mw-eyebrow">YOUR WEEK, AT A GLANCE</div><h2 id="gc-title">השבוע שלך.</h2><p>Google Calendar · קריאה בלבד · שעון ישראל</p></div><a class="gc-open" href="https://calendar.google.com/calendar/u/0/r/week" target="_blank" rel="noopener noreferrer">ליומן המלא ↖</a></div>';
  if(!connected){h+='<div class="gc-connect"><div><b>כל הלו״ז שלך במקום אחד</b><p>עבודה, לימודים ואימונים מהיומנים שתבחר. החיבור לא משנה אירועים.</p></div><button class="btn btn-p" onclick="gcConnect()" '+(gc.connecting?'disabled':'')+'>'+(gc.connecting?'מתחבר…':'חיבור ל־Google Calendar')+'</button></div>';}
  if(connected){
    h+='<div class="gc-toolbar"><div class="gc-week-controls"><button onclick="gcMove(-1)" aria-label="השבוע הקודם" '+(gc.loading?'disabled':'')+'>→</button><strong>'+esc(new Date(week+'T12:00Z').toLocaleDateString('he-IL',{day:'numeric',month:'short'}))+' – '+esc(new Date(gcAdd(week,6)+'T12:00Z').toLocaleDateString('he-IL',{day:'numeric',month:'short',year:'numeric'}))+'</strong><button onclick="gcMove(1)" aria-label="השבוע הבא" '+(gc.loading?'disabled':'')+'>←</button><button onclick="gcThisWeek()" '+(gc.loading?'disabled':'')+'>השבוע</button></div><button class="gc-open" onclick="gcLoad()" '+(gc.loading?'disabled':'')+'>'+(gc.loading?'טוען…':'רענון ↻')+'</button></div>';
    h+='<details class="gc-sources"><summary>יומנים מוצגים ('+gc.calendars.filter(c=>c.show).length+')</summary><div class="gc-source-list">';
    gc.calendars.forEach((c,i)=>{h+='<label><input type="checkbox" '+(c.show?'checked ':'')+(gc.loading?'disabled ':'')+'onchange="gcToggle('+i+',this.checked)"/><i style="background:'+(/^#[0-9a-f]{6}$/i.test(c.backgroundColor||'')?c.backgroundColor:'#9de5d3')+'"></i>'+esc(c.summaryOverride||c.summary||'יומן')+'</label>';});h+='</div></details>';
    if(gc.loading)h+='<p class="gc-message" role="status">טוען את אירועי השבוע…</p>';
    else if(!gc.error){h+=gcTimeline(gc.events,week,7);}
    if(gc.fetchedAt)h+='<div class="gc-foot"><span>עודכן '+esc(gcTime(gc.fetchedAt))+' · '+(gc.mode==='server'?'חיבור מתמשך':'חיבור זמני')+'</span>'+(gc.serverConfigured&&gc.mode!=='server'?'<button onclick="gcConnect()">שמירת חיבור מתמשך</button>':'')+'<button onclick="gcDisconnect()">ניתוק התצוגה</button></div>';
  }
  if(gc.error)h+='<p class="gc-message gc-error" role="alert">'+esc(gc.error)+'</p>';
  if(gc.warnings.length)h+='<p class="gc-message gc-error">תצוגה חלקית: '+gc.warnings.map(esc).join(' ')+'</p>';
  el.innerHTML=h+'</section>';
  gcPositionTimeline(el.id);
}
function gcEnsureToday(){
  const week=gcSunday(gcDay());
  if(gc.token&&gc.expires>Date.now()&&!gc.loading&&!gc.error&&!gc.weeks?.[week]){gc.week=week;gcLoad();}
}
function gcRenderToday(){
  const el=document.getElementById('google-today');if(!el)return;
  if(!currentUser){el.replaceChildren();return;}
  if(gc.uid!==currentUser.uid)gcAuthChanged(currentUser);
  const today=gcDay(),week=gcSunday(today),connected=!!gc.token&&gc.expires>Date.now();
  const data=gc.weeks?.[week];
  let h='<section class="gc-overview gc-today-overview" aria-labelledby="gc-today-title"><div class="gc-top"><div><div class="mw-eyebrow">TODAY, IN FOCUS</div><h2 id="gc-today-title">הלו״ז שלך להיום.</h2><p>'+esc(new Date(today+'T12:00:00Z').toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'}))+' · Google Calendar · שעון ישראל</p></div><button class="gc-open" onclick="goTo(\'calendar\')">לשבוע המלא ↖</button></div>';
  if(!connected)h+='<div class="gc-connect"><p>חבר את Google Calendar להצגת אירועי היום כאן. החיבור הוא לקריאה בלבד.</p><button class="btn btn-p" onclick="gcConnect()" '+(gc.connecting?'disabled':'')+'>'+(gc.connecting?'מתחבר…':'חיבור ליומן')+'</button></div>';
  else if(gc.loading&&gc.week===week)h+='<p class="gc-message" role="status">טוען את הלו״ז של היום…</p>';
  else if(data){
    const events=data.events.filter(e=>gcEventDays(e,week).includes(today)).sort((a,b)=>Number(!a.start?.date)-Number(!b.start?.date)||(a.start.dateTime||a.start.date).localeCompare(b.start.dateTime||b.start.date));
    h+=gcTimeline(events,today,1);
    if(data.warnings.length)h+='<p class="gc-message gc-error">תצוגה חלקית: '+data.warnings.map(esc).join(' ')+'</p>';
    h+='<div class="gc-foot"><span>'+events.length+' אירועים · עודכן '+esc(gcTime(data.fetchedAt))+'</span><button onclick="gcRefreshToday()">רענון ↻</button></div>';
  }else h+='<p class="gc-message">'+esc(gc.error||'נתוני היום עדיין לא נטענו.')+'</p><button class="gc-open" onclick="gcRefreshToday()" '+(gc.loading?'disabled':'')+'>טעינת הלו״ז של היום</button>';
  if(gc.error)h+='<p class="gc-message gc-error" role="alert">'+esc(gc.error)+'</p>';
  el.innerHTML=h+'</section>';
  gcPositionTimeline(el.id);
}
function gcRefreshToday(){if(gc.loading)return;gc.week=gcSunday(gcDay());gcLoad();}
