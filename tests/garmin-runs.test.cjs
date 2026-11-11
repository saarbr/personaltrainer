const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('same-day Garmin activity completes only an unambiguous run and renders one escaped summary', () => {
  const context = vm.createContext({
    document: { addEventListener() {} },
    RUNS: [{ garminId: '123', date: '2026-11-11', km: 5 }],
    esc: value => String(value).replaceAll('<', '&lt;'),
    fmtPace: seconds => String(seconds)
  });
  vm.runInContext(fs.readFileSync(require.resolve('../garmin-route.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../garmin-runs.js'), 'utf8'), context);
  vm.runInContext("garminRunSync.runs = [{garminId:'123',date:'2026-11-11',km:5,name:'<img>',durationSec:1500}]", context);
  assert.equal(context.recentGarminRuns().length, 1);
  const workouts = [{ type: 'strength' }, { type: 'run' }];
  assert.equal(context.garminCompletedWorkout('2026-11-11', workouts, 0), false);
  assert.equal(context.garminCompletedWorkout('2026-11-11', workouts, 1), true);
  assert.equal(context.garminCompletedWorkout('2026-11-12', workouts, 1), false);
  assert.equal(context.garminCompletedWorkout('2026-11-11', [...workouts, { type: 'run' }], 1), false);
  const summary = context.renderLatestGarminRun();
  assert.match(summary, /&lt;img>/);
  assert.match(summary, /5\.00/);
  assert.match(summary, /activity\/123/);
  assert.match(summary, /data-garmin-route="123" open/);
  assert.doesNotMatch(summary, /<img>/);
});
