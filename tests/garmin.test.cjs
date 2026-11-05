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
    if(url.includes('personal-api-key/token'))return {ok:true,json:async()=>({access_token:'secret-bearer'})};
    return {ok:true,json:async()=>[
      {activityId:12,distance:5000,averageSpeed:4,averageHR:145,startTimeLocal:'2026-11-05 07:30:00',activityName:'Run'},
      {activityId:13,distance:5000,averageSpeed:null,startTimeLocal:'2026-11-05'}
    ]};
  };
  assert.equal((await handler({...event,body:'{"start":-1}'})).statusCode,400);
  const result=await handler(event);
  assert.equal(result.statusCode,200);
  const data=JSON.parse(result.body);
  assert.equal(data.runs.length,1);
  assert.equal(data.runs[0].paceSec,250);
  assert.equal(data.runs[0].garminId,'12');
  assert.equal(data.skipped,1);
  assert.equal(data.nextStart,null);
  assert.ok(!result.body.includes('secret-'));
  global.fetch=async()=>{throw Error('secret-test-key');};
  assert.ok(!(await handler(event)).body.includes('secret-'));
});

