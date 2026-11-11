const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/garmin');
test('owner-only Garmin import preserves provider speed and never returns credentials', async () => {
  process.env.FIREBASE_API_KEY='firebase-test';
  process.env.GARMIN_PERSONAL_API_KEY='secret-test-key';
  process.env.GARMIN_ALLOWED_UID='owner';
  let calls=[];
  global.fetch=async(url, options)=>{
    calls.push({url,options});
    if(url.includes('accounts:lookup'))return {ok:true,json:async()=>({users:[{localId:'other'}]})};
    throw Error('Unexpected request');
  };
  assert.equal((await handler({httpMethod:'POST',headers:{}})).statusCode,401);
  const event={httpMethod:'POST',headers:{authorization:'Bearer firebase-token'},body:'{}'};
  assert.equal((await handler(event)).statusCode,403);
  assert.equal(calls.length,1);
  global.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url.includes('accounts:lookup'))return {ok:true,json:async()=>({users:[{localId:'owner'}]})};
    if(url.includes('personal-api-key/token'))return {ok:true,text:async()=> 'header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+86400})).toString('base64url')+'.secret-signature\n'};
    return {ok:true,json:async()=>[
      {activityId:12,distance:5000,averageSpeed:4,averageHR:145,startTimeLocal:'2026-11-05 07:30:00',activityName:'Run'},
      {activityId:13,distance:5000,averageSpeed:null,duration:1500,startTimeLocal:'2026-11-05'},
      {activityId:14,distance:5000,startTimeLocal:'2026-11-05'},
      {activityId:15,distance:5000,startTimeLocal:'2026-02-30'}
    ]};
  };
  assert.equal((await handler({...event,body:'{"start":-1}'})).statusCode,400);
  const result=await handler(event);
  assert.equal(result.statusCode,200);
  const data=JSON.parse(result.body);
  assert.equal(data.runs.length,3);
  assert.equal(data.runs[0].paceSec,250);
  assert.equal(data.runs[0].garminId,'12');
  assert.equal(data.runs[1].paceSec,300);
  assert.equal(data.runs[1].durationSec,1500);
  assert.equal(data.runs[2].paceSec,null);
  assert.equal(data.skipped,1);
  assert.equal(data.nextStart,null);
  const lastRunFetch=global.fetch;
  global.fetch=async(url,options)=>{
    if(url.includes('accounts:lookup'))return {ok:true,json:async()=>({users:[{localId:'owner'}]})};
    if(url.includes('/hrv-service/'))return {ok:false,status:503};
    if(url.endsWith('/stats/steps/daily/2026-11-05/2026-11-05'))return {ok:true,text:async()=>JSON.stringify([{calendarDate:'2026-11-05',totalSteps:4321,stepGoal:8000}])};
    return {ok:true,text:async()=>JSON.stringify(url.includes('dailySleep?')?{dailySleepDTO:{sleepTimeSeconds:28800}}:{data:[]})};
  };
  const wellness=await handler({...event,body:JSON.stringify({action:'wellness',date:'2026-11-05'})});
  assert.equal(wellness.statusCode,200);
  const health=JSON.parse(wellness.body);
  assert.equal(health.sections.sleep.data.dailySleepDTO.sleepTimeSeconds,28800);
  assert.equal(health.sections.hrv.status,'error');
  assert.equal(health.sections.steps.data[0].totalSteps,4321);
  assert.equal(Object.keys(health.sections).length,7);
  assert.equal((await handler({...event,body:JSON.stringify({action:'wellness',date:'2026-02-30'})})).statusCode,400);
  assert.equal((await handler({...event,body:JSON.stringify({action:'anything'})})).statusCode,400);
  global.fetch=lastRunFetch;
  assert.ok(!result.body.includes('secret-'));
  global.fetch=async()=>{throw Error('secret-test-key');};
  assert.ok(!(await handler(event)).body.includes('secret-'));
});

