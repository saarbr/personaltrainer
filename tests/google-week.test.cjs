const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
  const el={innerHTML:'',replaceChildren(){this.innerHTML='';}};
  const c=vm.createContext({Date,Intl,URL,AbortSignal,console,currentUser:{uid:'owner'},document:{getElementById:()=>el},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
  vm.runInContext(fs.readFileSync(require.resolve('../google-week.js'),'utf8'),c);return {c,el};
}
test('Israel week boundaries include the full DST transition week',()=>{
  const {c}=setup();
  assert.equal(vm.runInContext("gcSunday('2026-11-07')",c),'2026-11-01');
  assert.equal(vm.runInContext("gcMidnight('2026-11-01')",c),'2026-10-31T22:00:00.000Z');
  assert.equal(vm.runInContext("(Date.parse(gcMidnight('2026-10-25'))-Date.parse(gcMidnight('2026-10-18')))/3600000",c),168);
  assert.equal(vm.runInContext("(Date.parse(gcMidnight('2026-11-01'))-Date.parse(gcMidnight('2026-10-25')))/3600000",c),169);
});
test('all-day exclusive ends and overnight events appear on correct days',()=>{
  const {c}=setup();
  assert.deepEqual(Array.from(vm.runInContext("gcEventDays({start:{date:'2026-11-02'},end:{date:'2026-11-04'}},'2026-11-01')",c)),['2026-11-02','2026-11-03']);
  assert.deepEqual(Array.from(vm.runInContext("gcEventDays({start:{dateTime:'2026-11-02T23:00:00+02:00'},end:{dateTime:'2026-11-03T01:00:00+02:00'}},'2026-11-01')",c)),['2026-11-02','2026-11-03']);
  assert.deepEqual(Array.from(vm.runInContext("gcEventDays({start:{dateTime:'2026-11-02T23:00:00+02:00'},end:{dateTime:'2026-11-03T00:00:00+02:00'}},'2026-11-01')",c)),['2026-11-02']);
});
test('pagination and recurring expansion are read-only; private text is escaped; logout clears data',async()=>{
  const {c,el}=setup();let calls=[];
  c.fetch=async(url,opts)=>{calls.push({url,opts});const u=new URL(url);assert.ok(!opts.method||opts.method==='GET');
    if(u.pathname.endsWith('calendarList'))return {ok:true,json:async()=>({items:[{id:'owner@example.com',summary:'Main',primary:true,backgroundColor:'#123456'}]})};
    assert.equal(u.searchParams.get('singleEvents'),'true');assert.equal(u.searchParams.get('timeZone'),'Asia/Jerusalem');
    return {ok:true,json:async()=>u.searchParams.has('pageToken')?{items:[]}:{nextPageToken:'next',items:[{id:'a',summary:'<script>unsafe</script>',start:{date:'2026-11-02'},end:{date:'2026-11-03'},htmlLink:'javascript:alert(1)'}]}};
  };
  vm.runInContext("gc.uid='owner';gc.token='private-token';gc.expires=Date.now()+600000;gc.week='2026-11-01'",c);
  await vm.runInContext('gcLoad()',c);
  assert.equal(calls.length,3);
  assert.ok(el.innerHTML.includes('&lt;script&gt;'));
  assert.ok(!el.innerHTML.includes('javascript:'));
  assert.ok(!el.innerHTML.includes('private-token'));
  vm.runInContext('gcAuthChanged(null)',c);
  assert.equal(vm.runInContext('gc.events.length',c),0);
  assert.equal(vm.runInContext('gc.token',c),null);
  assert.equal(el.innerHTML,'');
});
test('home shows only today and keeps its cache when the weekly tab moves',()=>{
  const {c}=setup();const todayEl={innerHTML:'',replaceChildren(){this.innerHTML='';}};const weekEl={innerHTML:'',replaceChildren(){this.innerHTML='';}};
  c.document.getElementById=id=>id==='google-today'?todayEl:weekEl;
  vm.runInContext(`gcDay=function(value){return value?new Intl.DateTimeFormat('en-CA',{timeZone:GC_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'2026-11-07'};gc.uid='owner';gc.token='secret';gc.expires=Date.now()+600000;gc.week='2026-11-08';gc.weeks={'2026-11-01':{events:[{summary:'Today only',calendarName:'Main',calendarColor:'#123456',start:{date:'2026-11-07'},end:{date:'2026-11-08'}},{summary:'Yesterday only',calendarName:'Main',calendarColor:'#123456',start:{date:'2026-11-06'},end:{date:'2026-11-07'}}],warnings:[],fetchedAt:'2026-11-07T08:00:00Z'}};gc.events=[{summary:'Next week only',start:{date:'2026-11-08'},end:{date:'2026-11-09'}}];gcRenderToday();`,c);
  assert.ok(todayEl.innerHTML.includes('Today only'));
  assert.ok(!todayEl.innerHTML.includes('Yesterday only'));
  assert.ok(!todayEl.innerHTML.includes('Next week only'));
  assert.ok(todayEl.innerHTML.includes("goTo('calendar')"));
});
