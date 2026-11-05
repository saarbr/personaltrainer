/* Garmin data is held in memory only, scoped to the signed-in user and date. */
let garminView={date:null,uid:null,result:null,error:'',loading:false,requestId:0};
function clearGarminData(){
  garminView={date:null,uid:null,result:null,error:'',loading:false,requestId:garminView.requestId+1};
  const el=document.getElementById('pg-garmin');if(el)el.replaceChildren();
}
function garminNumber(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
function garminAt(object,path){return path.split('.').reduce((v,k)=>v?.[k],object);}
function garminPick(object,paths){for(const path of paths){const n=garminNumber(garminAt(object,path));if(n!==null)return n;}return null;}
function garminFirst(data){if(Array.isArray(data))return data[0]||{};if(Array.isArray(data?.data))return data.data[0]||{};return data||{};}
function garminDuration(seconds){const n=garminNumber(seconds);return n===null?'אין נתון':Math.floor(n/3600)+' ש׳ '+Math.floor((n%3600)/60)+' דק׳';}
function garminCard(label,value,unit=''){
  return '<div class="card" style="margin:0;min-width:0;padding:14px"><div style="font-size:11px;color:var(--muted);margin-bottom:8px">'+esc(label)+'</div><div style="font-size:23px;font-weight:800;overflow-wrap:anywhere">'+(value===null?'<span style="font-size:13px;color:var(--muted)">אין נתון</span>':esc(String(value)))+'</div>'+(value===null?'':'<div style="font-size:10px;color:var(--muted);margin-top:3px">'+esc(unit)+'</div>')+'</div>';
}
function garminGrid(cards){return '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:16px">'+cards.join('')+'</div>';}
function garminHeading(title,section){
  const state=section?.status;
  return '<h2 style="font-size:17px;margin:22px 0 10px">'+esc(title)+'</h2>'+(state==='error'?'<p style="color:var(--coral);font-size:12px">הנתונים במדור הזה לא התקבלו. אפשר לנסות לרענן.'+(section.httpStatus?' ('+Number(section.httpStatus)+')':'')+'</p>':state==='empty'?'<p style="color:var(--muted);font-size:12px">Garmin לא החזירה נתונים ליום הנבחר.</p>':'');
}
function renderGarmin(){
  const el=document.getElementById('pg-garmin');if(!el)return;
  if(!currentUser){el.textContent='יש להיכנס לחשבון כדי לצפות בנתוני Garmin.';return;}
  if(garminView.uid&&garminView.uid!==currentUser.uid)clearGarminData();
  if(!garminView.date)garminView.date=todayStr();
  let h='<div style="padding-top:8px"><h1 style="font-size:25px;margin:0 0 5px">היום שלי ב־Garmin</h1><p style="font-size:12px;color:var(--muted);margin:0 0 16px">מקור: Garmin · נתוני השעון כפי שהתקבלו ב־Garmin Connect</p>';
  h+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><label for="garmin-date" style="font-size:12px">יום</label><input class="inp" id="garmin-date" type="date" max="'+todayStr()+'" value="'+esc(garminView.date)+'" onchange="changeGarminDate(this.value)" style="min-width:0;flex:1"/><button class="btn btn-p" onclick="loadGarminWellness()" '+(garminView.loading?'disabled':'')+'>'+ (garminView.loading?'מעדכן…':'רענון')+'</button></div>';
  h+='<p style="font-size:11px;color:var(--muted)">מתעדכן בפתיחת הלשונית וברענון. תחילה יש לסנכרן את השעון עם Garmin Connect. אין ניטור ברקע.</p>';
  if(garminView.loading)h+='<p role="status" style="font-size:13px">טוען את נתוני היום הנבחר…</p>';
  if(garminView.error)h+='<p role="alert" style="color:var(--coral)">'+esc(garminView.error)+'</p>';
  const result=garminView.result;
  if(result){
    h+='<p style="font-size:11px;color:var(--muted)">יום מדידה: '+esc(result.date)+' · התקבל באפליקציה: '+esc(new Date(result.fetchedAt).toLocaleString('he-IL'))+'</p>';
    const s=result.sections;
    const sleep=s.sleep?.status==='ok'?(s.sleep.data?.dailySleepDTO||s.sleep.data||{}):{};
    h+=garminHeading('שינה',s.sleep);
    h+=garminGrid([
      garminCard('משך השינה',garminPick(sleep,['sleepTimeSeconds'])===null?null:garminDuration(sleep.sleepTimeSeconds)),
      garminCard('ציון שינה',garminPick(sleep,['sleepScores.overall.value','sleepScore']),'מתוך 100'),
      garminCard('שינה עמוקה',garminPick(sleep,['deepSleepSeconds'])===null?null:garminDuration(sleep.deepSleepSeconds)),
      garminCard('שינה קלה',garminPick(sleep,['lightSleepSeconds'])===null?null:garminDuration(sleep.lightSleepSeconds)),
      garminCard('שנת REM',garminPick(sleep,['remSleepSeconds'])===null?null:garminDuration(sleep.remSleepSeconds)),
      garminCard('זמן ערות',garminPick(sleep,['awakeSleepSeconds'])===null?null:garminDuration(sleep.awakeSleepSeconds))
    ]);
    const summary=s.summary?.status==='ok'?garminFirst(s.summary.data):{};
    const hr=s.heartRate?.status==='ok'?(s.heartRate.data||{}):{};
    const hrv=s.hrv?.status==='ok'?(s.hrv.data?.hrvSummary||s.hrv.data||{}):{};
    const battery=s.bodyBattery?.status==='ok'?garminFirst(s.bodyBattery.data):{};
    const values=Array.isArray(battery.bodyBatteryValuesArray)?battery.bodyBatteryValuesArray.filter(row=>Array.isArray(row)&&garminNumber(row[2])!==null):[];
    const latestBattery=values.length?values[values.length-1][2]:null;
    h+=garminHeading('התאוששות ו־Body Battery',s.bodyBattery);
    h+=garminGrid([
      garminCard('Body Battery — מדידה אחרונה',latestBattery,'מתוך 100 · ליום הנבחר'),
      garminCard('Body Battery — נטען',garminPick(battery,['charged']),'נקודות'),
      garminCard('Body Battery — נצרך',garminPick(battery,['drained']),'נקודות')
    ]);
    h+=garminHeading('HRV — שונות הדופק',s.hrv);
    h+=garminGrid([
      garminCard('ממוצע לילי',garminPick(hrv,['lastNightAvg']),'מילישניות'),
      garminCard('ממוצע שבועי',garminPick(hrv,['weeklyAvg']),'מילישניות')
    ]);
    h+=garminHeading('דופק',s.heartRate);
    h+=garminGrid([
      garminCard('דופק במנוחה',garminPick(hr,['restingHeartRate'])??garminPick(summary,['restingHeartRate']),'פעימות לדקה'),
      garminCard('דופק מרבי',garminPick(hr,['maxHeartRate'])??garminPick(summary,['maxHeartRate']),'פעימות לדקה'),
      garminCard('דופק מזערי',garminPick(hr,['minHeartRate'])??garminPick(summary,['minHeartRate']),'פעימות לדקה')
    ]);
    h+=garminHeading('תנועה, אנרגיה וסטרס',s.summary);
    h+=garminGrid([
      garminCard('צעדים',garminPick(summary,['totalSteps']),'צעדים'),
      garminCard('יעד צעדים',garminPick(summary,['dailyStepGoal']),'צעדים'),
      garminCard('קלוריות פעילות',garminPick(summary,['activeKilocalories']),'קק״ל · הערכת Garmin'),
      garminCard('סה״כ קלוריות',garminPick(summary,['totalKilocalories']),'קק״ל · הערכת Garmin'),
      garminCard('סטרס ממוצע',garminPick(summary,['averageStressLevel']),'מתוך 100'),
      garminCard('דקות פעילות מתונה',garminPick(summary,['moderateIntensityMinutes']),'דקות'),
      garminCard('דקות פעילות עצימה',garminPick(summary,['vigorousIntensityMinutes']),'דקות'),
      garminCard('קומות שעלית',garminPick(summary,['floorsAscended']),'קומות')
    ]);
    h+=garminHeading('הפעילויות שלי',s.activities);
    const activities=s.activities?.status==='ok'&&Array.isArray(s.activities.data)?s.activities.data:[];
    if(!activities.length&&s.activities?.status==='ok')h+='<p style="font-size:12px;color:var(--muted)">אין פעילויות ליום הזה.</p>';
    for(const a of activities){
      h+='<div class="card"><div style="font-weight:700">'+esc(a.activityName||'פעילות')+'</div><div style="font-size:10px;color:var(--muted);margin:4px 0">מקור: Garmin'+(a.deviceName?' · '+esc(a.deviceName):'')+'</div><div style="font-size:12px">';
      if(garminNumber(a.distance)!==null)h+=esc((a.distance/1000).toFixed(2))+' ק״מ · ';
      h+=garminDuration(a.duration);
      if(garminNumber(a.averageHR)!==null)h+=' · דופק ממוצע '+esc(String(a.averageHR));
      h+='</div></div>';
    }
    if(activities.length===20)h+='<p style="font-size:11px;color:var(--muted)">מוצגות עד 20 פעילויות ליום הנבחר.</p>';
    h+='<p style="font-size:11px;color:var(--muted)">נתון חסר אינו אפס. הזמינות תלויה בשעון, במדידות ובסנכרון. מדדי Garmin הם הערכות ואינם אבחנה רפואית.</p>';
  }
  el.innerHTML=h+'</div>';
  if(!garminView.loading&&!garminView.result&&!garminView.error)loadGarminWellness();
}
function changeGarminDate(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;garminView.requestId++;garminView.date=date;garminView.result=null;garminView.error='';garminView.loading=false;loadGarminWellness();}
async function loadGarminWellness(){
  if(!currentUser||garminView.loading)return;
  const user=currentUser;const date=garminView.date||todayStr();const requestId=++garminView.requestId;
  garminView.loading=true;garminView.uid=user.uid;garminView.date=date;garminView.error='';garminView.result=null;renderGarmin();
  try{
    const token=await user.getIdToken();
    const response=await fetch('/.netlify/functions/garmin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'wellness',date}),signal:AbortSignal.timeout(25000)});
    const data=await response.json();
    if(currentUser?.uid!==user.uid||garminView.requestId!==requestId)return;
    if(!response.ok)throw Error(data.error||'לא ניתן לקבל נתונים כרגע.');
    if(!data.sections||data.date!==date)throw Error('התקבלה תשובה לא צפויה. נסה לרענן.');
    garminView.result=data;
  }catch(error){if(currentUser?.uid===user.uid&&garminView.requestId===requestId)garminView.error=error.name==='TimeoutError'?'הבקשה ארכה זמן רב. נסה לרענן.':error.message||'תקלה בקבלת הנתונים.';}
  finally{if(currentUser?.uid===user.uid&&garminView.requestId===requestId){garminView.loading=false;if(currentPg==='garmin')renderGarmin();}}
}
