const { test } = require('node:test');
const assert = require('node:assert/strict');
const { zipSync } = require('fflate');
const { detailsFromActivity } = require('../netlify/lib/garmin-route.cjs');

test('Garmin FIT ZIP produces a scaled sketch and GPS-free files produce no route', async () => {
  const { Encoder } = await import('@garmin/fitsdk');
  const encoder = new Encoder();
  encoder.writeMesg({ mesgNum: 20, positionLat: 380000000, positionLong: 410000000 });
  encoder.writeMesg({ mesgNum: 20, positionLat: 380010000, positionLong: 410000000 });
  encoder.writeMesg({ mesgNum: 20, positionLat: 380010000, positionLong: 410010000 });
  const bytes = encoder.close();
  const { points, imageryBounds } = await detailsFromActivity(new Response(zipSync({ 'activity.fit': bytes })));
  assert.equal(points.length, 3);
  assert.equal(points[0][0], points[1][0]);
  assert.equal(points[1][1], points[2][1]);
  assert.ok(points[1][1] < points[0][1]);
  assert.ok(points[2][0] > points[1][0]);
  const [west, south, east, north] = imageryBounds;
  assert.ok(Math.abs((east - west) / (north - south) - 340 / 180) < 1e-8);
  const semiToRad = Math.PI / 2 ** 31;
  const firstX = 6378137 * 410000000 * semiToRad;
  const firstY = 6378137 * Math.asinh(Math.tan(380000000 * semiToRad));
  // The image corners are the SVG viewBox corners, including its 10px margin.
  assert.equal(points[0][0], Math.round(340 * (firstX - west) / (east - west) - 10));
  assert.equal(points[0][1], Math.round(180 * (north - firstY) / (north - south) - 10));
  const indoor = new Encoder();
  indoor.writeMesg({ mesgNum: 20, heartRate: 140 });
  assert.deepEqual((await detailsFromActivity(new Response(indoor.close()))).points, []);
});

test('FIT lap and record messages provide splits and timestamped charts without GPS', async () => {
  const { Encoder } = await import('@garmin/fitsdk');
  const encoder = new Encoder();
  const timestamp = 1100000000;
  encoder.writeMesg({ mesgNum: 20, timestamp, heartRate: 142, speed: 2.5 });
  encoder.writeMesg({ mesgNum: 20, timestamp: timestamp + 15, enhancedSpeed: 4, heartRate: 154 });
  encoder.writeMesg({ mesgNum: 20, timestamp: timestamp + 45, speed: 0 });
  encoder.writeMesg({ mesgNum: 19, totalDistance: 1000, totalTimerTime: 300, totalElapsedTime: 330, avgHeartRate: 150 });
  const result = await detailsFromActivity(new Response(encoder.close()));
  assert.deepEqual(result, {
    points: [],
    splits: [{ distanceM: 1000, durationSec: 300, avgHr: 150 }],
    heartRate: [[0, 142], [15, 154]],
    pace: [[0, 400], [15, 250]],
    elapsedSec: 45
  });
});
