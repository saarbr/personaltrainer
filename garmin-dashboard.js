/* Garmin data is held in memory only, scoped to the signed-in user and date. */
let garminView={date:null,uid:null,result:null,error:'',loading:false,requestId:0};
function clearGarminData(){
  garminView={date:null,uid:null,result:null,error:'',loading:false,requestId:garminView.requestId+1};
  const el=document.getElementById('pg-garmin');if(el)el.replaceChildren();
}
function garminNumber(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
function garminAt(object,path){return path.split('.').reduce((v,k)=>v?.[k],object);}
function garminPick(object,paths){
  const number=v=>garminNumber(v)??garminNumber(v?.value);
  for(const path of paths){const n=number(garminAt(object,path));if(n!==null)return n;}
  // Daily-summary responses can wrap their records inside data/date/value maps.
  // Match named provider fields only; never substitute unrelated numeric samples.
  const search=(value,depth)=>{
    if(!value||typeof value!=='object'||depth>6)return null;
    for(const path of paths){const n=number(garminAt(value,path));if(n!==null)return n;}
    for(const child of Object.values(value)){if(child&&typeof child==='object'){const n=search(child,depth+1);if(n!==null)return n;}}
    return null;
  };
  return search(object,0);
}
function garminFirst(data){if(Array.isArray(data))return data[0]||{};if(Array.isArray(data?.data))return data.data[0]||{};return data||{};}
function garminDailySteps(section,date,summary){
  const data=section?.status==='ok'?section.data:null;
  const records=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:[data?.data??data];
  const record=records.find(item=>item?.calendarDate===date)??records.find(item=>item&&!item.calendarDate&&records.length===1);
  return {
    steps:garminPick(record,['totalSteps'])??garminPick(summary,['totalSteps']),
    target:garminPick(record,['stepGoal','dailyStepGoal'])??garminPick(summary,['dailyStepGoal','stepGoal'])
  };
}
function garminDuration(seconds){const n=garminNumber(seconds);return n===null?'אין נתון':Math.floor(n/3600)+' ש׳ '+Math.floor((n%3600)/60)+' דק׳';}
function garminCard(label,value,unit=''){
  return '<div class="card" style="margin:0;min-width:0;padding:14px"><div style="font-size:11px;color:var(--muted);margin-bottom:8px">'+esc(label)+'</div><div style="font-size:23px;font-weight:800;overflow-wrap:anywhere">'+(value===null?'<span style="font-size:13px;color:var(--muted)">אין נתון</span>':esc(String(value)))+'</div>'+(value===null?'':'<div style="font-size:10px;color:var(--muted);margin-top:3px">'+esc(unit)+'</div>')+'</div>';
}
function garminGrid(cards){return '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:16px">'+cards.join('')+'</div>';}
function garminHeading(title,section){
  const state=section?.status;
  return '<h2 style="font-size:17px;margin:22px 0 10px">'+esc(title)+'</h2>'+(state==='error'?'<p style="color:var(--coral);font-size:12px">הנתונים במדור הזה לא התקבלו. אפשר לנסות לרענן.'+(section.httpStatus?' ('+Number(section.httpStatus)+')':'')+'</p>':state==='empty'?'<p style="color:var(--muted);font-size:12px">Garmin לא החזירה נתונים ליום הנבחר.</p>':'');
}
function renderGarmin(){return renderGarminVisual();}
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
