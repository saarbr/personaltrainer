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
  const coordinates = records.flatMap(({ positionLat, positionLong }) => {
    const lat = positionLat * semicircle, lon = positionLong * semicircle;
    return Number.isInteger(positionLat) && Number.isInteger(positionLong) &&
      positionLong !== 0x7fffffff && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [[lat, lon]] : [];
  });
  if (coordinates.length < 2) return [];
  const [lat0, lon0] = coordinates[0];
  const longitudeScale = Math.cos(lat0 * Math.PI / 180);
  const points = coordinates.map(([lat, lon]) => [((lon - lon0 + 540) % 360 - 180) * longitudeScale, lat0 - lat]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const width = maxX - minX, height = maxY - minY;
  if (!width && !height) return [];
  const scale = 1 / Math.max(width / 288, height / 128);
  const count = Math.min(points.length, 400);
  return Array.from({ length: count }, (_, i) => {
    const [x, y] = points[Math.round(i * (points.length - 1) / (count - 1))];
    return [Math.round(160 + (x - minX - width / 2) * scale), Math.round(80 + (y - minY - height / 2) * scale)];
  });
}

async function routeFromActivity(response) {
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
    if (!file) return [];
  }
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const decoder = new Decoder(Stream.fromBuffer(Buffer.from(file)));
  if (!decoder.isFIT()) return [];
  const { messages, errors } = decoder.read({ mergeHeartRates: false });
  if (errors.length) throw Error('Could not decode FIT activity');
  return projectRoute(messages.recordMesgs || []);
}

module.exports = { routeFromActivity };
