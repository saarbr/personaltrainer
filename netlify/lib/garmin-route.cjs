const MAX_BYTES = 8 * 1024 * 1024;

async function readActivityFile(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw Error('Activity file too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function projectRoute(records) {
  const semicircle = 180 / 2 ** 31;
  const earthRadius = 6378137;
  const worldEdge = Math.PI * earthRadius;
  const coordinates = records.flatMap(({ positionLat, positionLong }) => {
    const lat = positionLat * semicircle, lon = positionLong * semicircle;
    return Number.isInteger(positionLat) && Number.isInteger(positionLong) &&
      positionLong !== 0x7fffffff && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [[lat, lon]] : [];
  });
  if (coordinates.length < 2) return { points: [] };
  const [, lon0] = coordinates[0];
  // Match the imagery service's Web Mercator projection and unwrap longitude around the route.
  const points = coordinates.map(([lat, lon]) => {
    const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const longitude = lon0 + ((lon - lon0 + 540) % 360 - 180);
    return [longitude * worldEdge / 180, earthRadius * Math.asinh(Math.tan(latitude * Math.PI / 180))];
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const width = maxX - minX, height = maxY - minY;
  if (!width && !height) return { points: [] };
  const unitsPerPixel = Math.max(width / 288, height / 128, 80 / 340);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfWidth = 170 * unitsPerPixel, halfHeight = 90 * unitsPerPixel;
  const imageryBounds = [centerX - halfWidth, centerY - halfHeight, centerX + halfWidth, centerY + halfHeight];
  const count = Math.min(points.length, 400);
  const drawing = Array.from({ length: count }, (_, i) => {
    const [x, y] = points[Math.round(i * (points.length - 1) / (count - 1))];
    return [Math.round(160 + (x - centerX) / unitsPerPixel), Math.round(80 - (y - centerY) / unitsPerPixel)];
  });
  return {
    points: drawing,
    // Near the date line or poles, show the schematic instead of requesting a clipped image.
    ...(imageryBounds.every(value => Math.abs(value) <= worldEdge) && { imageryBounds })
  };
}

function activitySeries(records) {
  const samples = { heartRate: [], pace: [] };
  let startedAt;
  let lastTime = -1;
  for (const record of records) {
    if (!Number.isFinite(record.timestamp)) continue;
    startedAt ??= record.timestamp;
    const time = record.timestamp - startedAt;
    if (time < lastTime) continue;
    lastTime = time;
    if (record.heartRate > 0 && record.heartRate < 255) {
      samples.heartRate.push([time, record.heartRate]);
    }
    const speed = record.enhancedSpeed ?? record.speed;
    if (Number.isFinite(speed) && speed > 0) {
      samples.pace.push([time, Math.round(1000 / speed)]);
    }
  }
  for (const key of Object.keys(samples)) {
    const points = samples[key];
    if (points.length > 360) {
      samples[key] = Array.from({ length: 360 }, (_, i) =>
        points[Math.round(i * (points.length - 1) / 359)]
      );
    }
  }
  return { ...samples, elapsedSec: Math.max(0, lastTime) };
}

async function detailsFromActivity(response) {
  let file = await readActivityFile(response);
  if (file[0] === 0x50 && file[1] === 0x4b) {
    const { unzipSync } = require('fflate');
    let selected = false;
    const entries = unzipSync(file, { filter(entry) {
      if (selected || !/\.fit$/i.test(entry.name) || entry.originalSize > MAX_BYTES) return false;
      selected = true;
      return true;
    } });
    file = Object.values(entries)[0];
    if (!file) return { points: [] };
  }
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const decoder = new Decoder(Stream.fromBuffer(Buffer.from(file)));
  if (!decoder.isFIT()) return { points: [] };
  const { messages, errors } = decoder.read({ convertDateTimesToDates: false, mergeHeartRates: false });
  if (errors.length) throw Error('Could not decode FIT activity');
  const records = messages.recordMesgs || [];
  const splits = (messages.lapMesgs || []).slice(0, 500).map(lap => ({
    distanceM: lap.totalDistance ?? null,
    durationSec: lap.totalTimerTime ?? lap.totalElapsedTime ?? null,
    avgHr: lap.avgHeartRate || null
  }));
  return { ...projectRoute(records), splits, ...activitySeries(records) };
}

module.exports = { detailsFromActivity };
