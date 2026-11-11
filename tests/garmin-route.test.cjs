const { test } = require('node:test');
const assert = require('node:assert/strict');
const { zipSync } = require('fflate');
const { routeFromActivity } = require('../netlify/lib/garmin-route.cjs');

test('Garmin FIT ZIP produces a scaled sketch and GPS-free files produce no route', async () => {
  const { Encoder } = await import('@garmin/fitsdk');
  const encoder = new Encoder();
  encoder.writeMesg({ mesgNum: 20, positionLat: 380000000, positionLong: 410000000 });
  encoder.writeMesg({ mesgNum: 20, positionLat: 380010000, positionLong: 410000000 });
  encoder.writeMesg({ mesgNum: 20, positionLat: 380010000, positionLong: 410010000 });
  const bytes = encoder.close();
  const points = await routeFromActivity(new Response(zipSync({ 'activity.fit': bytes })));
  assert.equal(points.length, 3);
  assert.equal(points[0][0], points[1][0]);
  assert.equal(points[1][1], points[2][1]);
  assert.ok(points[1][1] < points[0][1]);
  assert.ok(points[2][0] > points[1][0]);
  const indoor = new Encoder();
  indoor.writeMesg({ mesgNum: 20, heartRate: 140 });
  assert.deepEqual(await routeFromActivity(new Response(indoor.close())), []);
});
