/* Visual layer: draws reported measurements only. No synthetic trends or readiness score. */
function gwIcon(kind){const icons={sleep:'☾',battery:'↗',heart:'♡',hrv:'∿',steps:'↟',activity:'↗'};return '<span class="gw-icon" aria-hidden="true">'+(icons[kind]||'·')+'</span>';}
function gwPanelStart(id,title,kind,tag=''){return '<section id="gw-'+id+'" class="gw-panel"><div class="gw-panel-title"><h2>'+gwIcon(kind)+esc(title)+'</h2><span class="gw-kicker">'+esc(tag)+'</span></div>';}
function gwSectionNote(section){return section?.status==='error'?'<div class="gw-notice gw-error">לא התקבלו נתונים למדד הזה. אפשר לרענן.'+(section.httpStatus?' ('+Number(section.httpStatus)+')':'')+'</div>':section?.status==='empty'?'<div class="gw-notice">אין נתונים ליום הנבחר ב־Garmin.</div>':'';}
function gwMetric(label,value,unit=''){return '<div class="gw-metric"><label>'+esc(label)+'</label><b>'+(value===null?'—':esc(String(value)))+'</b><small>'+esc(value===null?'אין נתון':unit)+'</small></div>';}
function gwRing(value,color,label){
  const n=garminNumber(value);const pct=n===null?0:Math.min(100,n);const circumference=289.027;
  return '<div class="gw-ring" role="img" aria-label="'+esc(label)+': '+(n===null?'אין נתון':esc(String(n))+' מתוך 100')+'"><svg viewBox="0 0 112 112" aria-hidden="true"><circle cx="56" cy="56" r="46" fill="none" stroke="rgba(210,235,255,.08)" stroke-width="6"/>'+(n===null?'':'<circle cx="56" cy="56" r="46" fill="none" stroke="'+color+'" stroke-width="6" stroke-linecap="round" stroke-dasharray="'+circumference+'" stroke-dashoffset="'+(circumference*(1-pct/100))+'"/>')+'</svg><div class="gw-ring-center"><strong>'+(n===null?'—':esc(String(n)))+'</strong><span>'+esc(label)+'</span></div></div>';
}
function gwPoints(rows,valueIndex){
  if(!Array.isArray(rows))return [];
  return rows.filter(r=>Array.isArray(r)&&typeof r[0]==='number'&&Number.isFinite(r[0])).map(r=>({t:r[0],v:garminNumber(r[valueIndex])})).sort((a,b)=>a.t-b.t);
}
function gwChart(points,color,label,unit,range){
  const valid=points.filter(p=>p.v!==null);
  if(valid.length<2)return '<div class="gw-chart-empty">אין מספיק מדידות להצגת גרף</div>';
  const first=points[0].t,last=points[points.length-1].t;
  if(last<=first)return '<div class="gw-chart-empty">אין מספיק מדידות להצגת גרף</div>';
  const lo=range?range[0]:Math.max(0,Math.min(...valid.map(p=>p.v))-5),hi=range?range[1]:Math.max(...valid.map(p=>p.v))+5;
  const x=t=>8+((t-first)/(last-first))*484;const y=v=>96-((v-lo)/(hi-lo||1))*80;
  let paths=[],segment=[];
  for(const p of points){if(p.v===null){if(segment.length)paths.push(segment);segment=[];}else segment.push(p);}
  if(segment.length)paths.push(segment);
  const fmt=t=>new Date(t).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
  let h='<svg class="gw-chart" viewBox="0 0 500 110" preserveAspectRatio="none" role="img" aria-label="'+esc(label)+' לפי שעה, '+esc(unit)+'"><title>'+esc(label)+' · '+esc(unit)+'</title>';
  for(const level of [lo,(lo+hi)/2,hi])h+='<line x1="8" x2="492" y1="'+y(level)+'" y2="'+y(level)+'" stroke="rgba(210,235,255,.07)" stroke-dasharray="3 5"/>';
  for(const group of paths)if(group.length>1)h+='<polyline points="'+group.map(p=>x(p.t).toFixed(1)+','+y(p.v).toFixed(1)).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';
  // Native SVG titles expose real measurement values; the line never joins explicit missing samples.
  const stride=Math.max(1,Math.floor(valid.length/50));
  valid.filter((_,i)=>i%stride===0||i===valid.length-1).forEach(p=>{h+='<circle tabindex="0" cx="'+x(p.t).toFixed(1)+'" cy="'+y(p.v).toFixed(1)+'" r="3" fill="'+color+'" opacity=".7"><title>'+esc(fmt(p.t)+' · '+p.v+' '+unit)+'</title></circle>';});
  h+='</svg><div class="gw-chart-labels"><span>'+esc(fmt(first))+'</span><span>'+esc(label)+' · '+esc(unit)+'</span><span>'+esc(fmt(last))+'</span></div>';
  return h;
}
function gwSleepStages(sleep){
  const stages=[['עמוקה','deepSleepSeconds','#b9acf2'],['קלה','lightSleepSeconds','#789bdb'],['REM','remSleepSeconds','#9bd8df'],['ערות','awakeSleepSeconds','#ecb898']];
  const values=stages.map(([label,key,color])=>({label,color,value:garminPick(sleep,[key])}));const total=values.reduce((sum,s)=>sum+(s.value??0),0);
  let h='<div class="gw-sub">חלוקת שלבי השינה'+(values.some(s=>s.value===null)?' · נתונים חלקיים':'')+'</div>';
  if(total>0){h+='<div class="gw-sleep-bar" role="img" aria-label="חלוקת משך השינה לפי שלבים; לא ציר זמן">';for(const s of values)if(s.value>0)h+='<div class="gw-sleep-segment" tabindex="0" style="width:'+(s.value/total*100)+'%;background:'+s.color+'" title="'+esc(s.label+' · '+garminDuration(s.value))+'"></div>';h+='</div>';}
  h+='<div class="gw-sleep-legend">';for(const s of values)h+='<div><span><i class="gw-dot" style="background:'+s.color+'"></i>'+esc(s.label)+'</span><b>'+(s.value===null?'אין נתון':esc(garminDuration(s.value)))+'</b></div>';return h+'</div>';
}
function gwRow(label,value,unit=''){return '<div class="gw-row"><span>'+esc(label)+'</span><strong>'+(value===null?'—':esc(String(value)))+' <small style="font-size:10px;color:var(--muted);font-weight:400">'+esc(value===null?'אין נתון':unit)+'</small></strong></div>';}
function gwShiftDate(delta){const date=new Date(garminView.date+'T12:00:00');date.setDate(date.getDate()+delta);const next=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');if(next<=todayStr())changeGarminDate(next);}
function gwScroll(section){document.getElementById('gw-'+section)?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
function renderGarminVisual(){
  const el=document.getElementById('pg-garmin');if(!el)return;
  if(!currentUser){el.textContent='יש להיכנס לחשבון כדי לצפות בנתוני Garmin.';return;}
  if(garminView.uid&&garminView.uid!==currentUser.uid)clearGarminData();
  if(!garminView.date)garminView.date=todayStr();
  const date=garminView.date;
  const displayDate=new Date(date+'T12:00:00').toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'});
  let h='<div class="gw"><div class="mw-page-intro"><div><div class="mw-eyebrow">LISTEN TO YOUR BODY</div><h1>הגוף שלך, בתמונה.</h1><p>השינה, ההתאוששות והתנועה שלך. מרחב אחד להקשיב לגוף.</p></div><span class="mw-date-pill">'+esc(displayDate)+'</span></div>';
  h+='<div class="gw-toolbar"><div class="gw-date-group"><button onclick="gwShiftDate(-1)" aria-label="היום הקודם">→</button><label class="mw-sr" for="garmin-date">יום</label><input id="garmin-date" type="date" max="'+todayStr()+'" value="'+date+'" onchange="changeGarminDate(this.value)"/><button onclick="gwShiftDate(1)" aria-label="היום הבא" '+(date>=todayStr()?'disabled':'')+'>←</button></div><button class="gw-refresh" onclick="loadGarminWellness()" '+(garminView.loading?'disabled':'')+'><span aria-hidden="true">↻</span> '+(garminView.loading?'מעדכן…':'רענון נתונים')+'</button></div><div class="gw-source">מקור: Garmin · '+esc(displayDate)+'</div>';
  h+='<div class="gw-tabs" role="group" aria-label="מעבר למדדים"><button onclick="gwScroll(\'sleep\')">שינה</button><button onclick="gwScroll(\'recovery\')">התאוששות</button><button onclick="gwScroll(\'heart\')">דופק</button><button onclick="gwScroll(\'movement\')">תנועה</button></div>';
  if(garminView.error)h+='<div role="alert" class="gw-notice gw-error">'+esc(garminView.error)+'</div>';
  const result=garminView.result;
  if(garminView.loading)h+='<div class="gw-grid" role="status" aria-live="polite"><div class="gw-loading">מתחברים לנתוני היום שלך…</div><div class="gw-loading">טוענים שינה והתאוששות…</div></div>';
  if(result){
    const s=result.sections;
    const sleep=s.sleep?.status==='ok'?(s.sleep.data?.dailySleepDTO||s.sleep.data||{}):{};
    const summary=s.summary?.status==='ok'?(s.summary.data||{}):{};
    const hr=s.heartRate?.status==='ok'?(s.heartRate.data||{}):{};
    const hrv=s.hrv?.status==='ok'?(s.hrv.data?.hrvSummary||s.hrv.data||{}):{};
    const battery=s.bodyBattery?.status==='ok'?garminFirst(s.bodyBattery.data):{};
    const batteryPoints=gwPoints(battery.bodyBatteryValuesArray,2);const bv=batteryPoints.filter(p=>p.v!==null);
    const latestBattery=bv.length?bv[bv.length-1].v:null;
    const sleepSecs=garminPick(sleep,['sleepTimeSeconds']);const sleepScore=garminPick(sleep,['sleepScores.overall.value','sleepScore']);
    h+='<div class="gw-grid">'+gwPanelStart('sleep','הלילה שלך','sleep','SLEEP');
    h+=gwSectionNote(s.sleep)+'<div class="gw-sleep-hero"><div><div class="gw-big">'+(sleepSecs===null?'—':esc(Math.floor(sleepSecs/3600)+':'+String(Math.floor(sleepSecs%3600/60)).padStart(2,'0')))+'</div><div class="gw-sub">'+(sleepSecs===null?'אין נתון למשך השינה':esc(garminDuration(sleepSecs)))+'</div></div>'+gwRing(sleepScore,'#bdb2ee','ציון שינה')+'</div>'+gwSleepStages(sleep)+'</section>';
    h+=gwPanelStart('recovery','האנרגיה שלך','battery','BODY BATTERY')+gwSectionNote(s.bodyBattery)+'<div class="gw-sleep-hero"><div><div class="gw-big">'+(latestBattery===null?'—':esc(String(latestBattery)))+'</div><div class="gw-sub">'+(latestBattery===null?'לא התקבלה מדידה אחרונה':'מדידה אחרונה · מתוך 100')+'</div></div>'+gwRing(latestBattery,'#a7e5d2','Body Battery')+'</div>'+gwChart(batteryPoints,'#a7e5d2','Body Battery','נקודות',[0,100])+gwRow('נטען',garminPick(battery,['charged']),'נקודות')+gwRow('נצרך',garminPick(battery,['drained']),'נקודות')+'</section>';
    h+=gwPanelStart('heart','הקצב שלך','heart','HEART RATE')+gwSectionNote(s.heartRate)+'<div class="gw-sleep-hero"><div><div class="gw-big">'+(garminPick(hr,['restingHeartRate'])??garminPick(summary,['restingHeartRate'])??'—')+'</div><div class="gw-sub">דופק במנוחה · פעימות לדקה</div></div><span style="font-size:42px;color:var(--gw-peach);font-weight:300" aria-hidden="true">♡</span></div>'+gwChart(gwPoints(hr.heartRateValues,1),'#edb39a','דופק','פעימות לדקה')+'<div class="gw-duo">'+gwMetric('מזערי',garminPick(hr,['minHeartRate'])??garminPick(summary,['minHeartRate']),'פעימות לדקה')+gwMetric('מרבי',garminPick(hr,['maxHeartRate'])??garminPick(summary,['maxHeartRate']),'פעימות לדקה')+'</div></section>';
    h+=gwPanelStart('hrv','האיזון שלך','hrv','HRV')+gwSectionNote(s.hrv)+'<div class="gw-duo">'+gwMetric('ממוצע לילי',garminPick(hrv,['lastNightAvg']),'מילישניות')+gwMetric('ממוצע שבועי',garminPick(hrv,['weeklyAvg']),'מילישניות')+'</div><div class="gw-sub" style="margin-top:18px;line-height:1.8">שונות הזמן בין פעימות הלב. הערכים מוצגים כפי שנמדדו ב־Garmin, ללא ציון התאוששות מחושב.</div>'+gwRow('סטרס ממוצע',garminPick(summary,['averageStressLevel']),'מתוך 100')+'</section>';
    const steps=garminPick(summary,['totalSteps']);const target=garminPick(summary,['dailyStepGoal']);
    h+=gwPanelStart('movement','תנועה ביום שלך','steps','DAILY MOVEMENT')+gwSectionNote(s.summary)+'<div class="gw-sleep-hero"><div><div class="gw-big">'+(steps===null?'—':steps.toLocaleString('he-IL'))+'</div><div class="gw-sub">צעדים'+(target===null?'':' · יעד '+target.toLocaleString('he-IL'))+'</div></div>'+gwRing(steps!==null&&target>0?Math.round(steps/target*100):null,'#98c5ee','% מהיעד')+'</div>';
    if(steps!==null&&target>0)h+='<div class="gw-progress-track"><div class="gw-progress-fill" style="width:'+Math.min(100,steps/target*100)+'%"></div></div>';
    h+=gwRow('פעילות מתונה',garminPick(summary,['moderateIntensityMinutes']),'דקות')+gwRow('פעילות עצימה',garminPick(summary,['vigorousIntensityMinutes']),'דקות')+gwRow('קומות שעלית',garminPick(summary,['floorsAscended']),'קומות')+'</section>';
    h+=gwPanelStart('energy','הוצאה אנרגטית','activity','ENERGY')+'<div class="gw-duo">'+gwMetric('קלוריות פעילות',garminPick(summary,['activeKilocalories']),'קק״ל')+gwMetric('סה״כ קלוריות',garminPick(summary,['totalKilocalories']),'קק״ל')+'</div><div class="gw-sub" style="margin-top:18px;line-height:1.8">הערכת ההוצאה האנרגטית של Garmin ליום הנבחר. הנתון עשוי להשתנות לאחר סנכרון השעון.</div></section>';
    h+='<section class="gw-panel gw-panel-wide"><div class="gw-panel-title"><h2>'+gwIcon('activity')+'הפעילויות שלך</h2><span class="gw-kicker">ACTIVITY</span></div>'+gwSectionNote(s.activities);
    const activities=s.activities?.status==='ok'&&Array.isArray(s.activities.data)?s.activities.data:[];
    if(!activities.length&&s.activities?.status!=='error')h+='<div class="gw-chart-empty">אין פעילויות להצגה ביום הזה.</div>';
    for(const a of activities)h+='<article class="gw-activity">'+gwIcon('activity')+'<div><h3>'+esc(a.activityName||'פעילות')+'</h3><p>מקור: Garmin'+(a.deviceName?' · '+esc(a.deviceName):'')+'</p></div><div class="gw-activity-stats"><div><strong>'+(garminNumber(a.distance)===null?'—':(a.distance/1000).toFixed(2))+'</strong><span>ק״מ</span></div><div><strong style="font-size:15px">'+esc(garminDuration(a.duration))+'</strong><span>משך הפעילות</span></div><div><strong>'+(garminNumber(a.averageHR)??'—')+'</strong><span>דופק ממוצע</span></div></div></article>';
    if(activities.length===20)h+='<div class="gw-sub">מוצגות עד 20 פעילויות ליום הנבחר.</div>';
    h+='</section></div><div class="gw-footer">עדכון אחרון: '+esc(new Date(result.fetchedAt).toLocaleString('he-IL'))+' · יום מדידה: '+esc(result.date)+'<br>נתון חסר אינו אפס. זמינות המדדים תלויה בשעון ובסנכרון. מדדי Garmin הם הערכות ואינם אבחנה רפואית.</div>';
  }
  h+='<p class="gw-footer">הנתונים מתעדכנים בפתיחת המסך וברענון, לאחר סנכרון עם Garmin Connect. אין ניטור ברקע.</p></div>';
  el.innerHTML=h;
  if(!garminView.loading&&!garminView.result&&!garminView.error)loadGarminWellness();
}
