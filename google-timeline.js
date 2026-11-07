/* Read-only 24-hour calendar, with explicit all-day lane and overlap columns. */
function gcHex(color){return /^#[0-9a-f]{6}$/i.test(color||'')?color:null;}
function gcEventColor(event){return gcHex(event.eventColor)||gcHex(event.calendarColor)||'#9de5d3';}
function gcInk(color){const n=parseInt(color.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return .2126*r+.7152*g+.0722*b>145?'#101d28':'#ffffff';}
function gcClockMinutes(value){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:GC_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);}
function gcTimedLayout(events,day){
  const start=Date.parse(gcMidnight(day)),end=Date.parse(gcMidnight(gcAdd(day,1)));
  const items=events.filter(e=>!e.start?.date&&e.status!=='cancelled'&&Date.parse(e.start?.dateTime)<end&&Date.parse(e.end?.dateTime)>start).map(event=>{
    const from=Date.parse(event.start.dateTime)<=start?0:gcClockMinutes(event.start.dateTime);
    const to=Date.parse(event.end.dateTime)>=end?1440:gcClockMinutes(event.end.dateTime);
    return {event,start:from,end:Math.min(1440,Math.max(from+1,to))};
  }).sort((a,b)=>a.start-b.start||b.end-a.end);
  let group=[],limit=-1;
  function finish(){
    const lanes=[];for(const item of group){let lane=lanes.findIndex(until=>until<=item.start);if(lane<0)lane=lanes.length;item.lane=lane;lanes[lane]=item.end;}for(const item of group)item.lanes=lanes.length;group=[];
  }
  for(const item of items){if(group.length&&item.start>=limit){finish();limit=-1;}group.push(item);limit=Math.max(limit,item.end);}
  if(group.length)finish();return items;
}
function gcTimelineEvent(event,style='',extra=''){
  const color=gcEventColor(event),url=gcSafeUrl(event.htmlLink),allDay=!!event.start.date;
  const time=allDay?'כל היום':gcTime(event.start.dateTime)+'–'+gcTime(event.end.dateTime);
  const description=(event.summary||'אירוע ללא כותרת')+' · '+time+' · '+event.calendarName;
  return '<'+(url?'a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer"':'div tabindex="0"')+' class="gc-time-event '+extra+'" style="--event-color:'+color+';--event-ink:'+gcInk(color)+';'+style+'" title="'+esc(description)+'" aria-label="'+esc(description)+'"><time>'+esc(time)+'</time><b>'+esc(event.summary||'אירוע ללא כותרת')+'</b><small>'+esc(event.calendarName)+(event.transparency==='transparent'?' · פנוי':'')+'</small></'+(url?'a':'div')+'>';
}
function gcTimeline(events,week,days=7){
  const today=gcDay();let h='<div class="gc-timeline-shell"><p class="gc-timeline-note">כל שעות היום · 00:00–24:00 · שעון ישראל. אפשר לגלול גם לשעות ריקות.</p><div class="gc-timeline-scroll" tabindex="0" aria-label="לוח שעות; גלול לצפייה בכל היום"><div class="gc-timeline-grid '+(days===1?'gc-one-day':'')+'" style="--gc-days:'+days+'"><div class="gc-axis-head">שעה</div>';
  for(let i=0;i<days;i++){
    const day=gcAdd(week,i);h+='<header class="gc-time-head '+(day===today?'gc-time-today':'')+'"><span>'+['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][new Date(day+'T12:00Z').getUTCDay()]+'</span><b>'+Number(day.slice(8))+'</b>'+(day===today?'<small>היום</small>':'')+'</header>';
  }
  h+='<div class="gc-axis-all">כל היום</div>';
  for(let i=0;i<days;i++){const day=gcAdd(week,i);h+='<div class="gc-all-lane">';for(const event of events.filter(e=>e.start?.date&&gcEventDays(e,gcSunday(day)).includes(day)))h+=gcTimelineEvent(event,'','gc-all-event');h+='</div>';}
  h+='<div class="gc-hours" aria-hidden="true">';for(let hour=0;hour<24;hour++)h+='<span style="top:'+(hour*64)+'px">'+String(hour).padStart(2,'0')+':00</span>';h+='<span style="top:1536px">24:00</span></div>';
  for(let i=0;i<days;i++){
    const day=gcAdd(week,i);h+='<section class="gc-hour-day" aria-label="שעות היום '+day+'">';
    for(let hour=0;hour<24;hour++)h+='<div class="gc-hour-cell" style="top:'+(hour*64)+'px" aria-hidden="true"></div>';
    for(const item of gcTimedLayout(events,day)){
      const top=item.start/60*64,height=(item.end-item.start)/60*64;
      h+=gcTimelineEvent(item.event,'top:'+top+'px;height:'+Math.max(16,height)+'px;right:calc('+item.lane*100/item.lanes+'% + 3px);width:calc('+100/item.lanes+'% - 6px);',height<42?'gc-short-event':'');
    }
    if(day===today){const mins=gcClockMinutes(new Date());h+='<div class="gc-now-line" style="top:'+mins/60*64+'px" aria-label="השעה עכשיו '+gcTime(new Date())+'"></div>';}
    h+='</section>';
  }
  return h+'</div></div></div>';
}
function gcPositionTimeline(containerId){
  if(typeof requestAnimationFrame!=='function')return;
  requestAnimationFrame(()=>{const el=document.getElementById(containerId)?.querySelector('.gc-timeline-scroll');if(el&&!el.dataset.positioned){el.scrollTop=7*64;el.dataset.positioned='true';}});
}
