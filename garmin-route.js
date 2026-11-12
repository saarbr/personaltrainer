const garminRouteCache = new Map();
const garminRouteObservers = new WeakMap();

function garminRouteMarkup(activityId, open = false) {
  const id = String(activityId);
  if (!/^\d{1,20}$/.test(id)) return '';
  return '<details class="garmin-route" data-garmin-route="' + id + '"' + (open ? ' open' : '') +
    '><summary>מסלול ונתוני הריצה</summary><div class="garmin-route-body" aria-live="polite"></div></details>';
}

function garminRouteDrawing(points) {
  const valid = Array.isArray(points) && points.length <= 400 && points.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isInteger) &&
    point[0] >= 0 && point[0] <= 320 && point[1] >= 0 && point[1] <= 160
  );
  if (!valid || points.length < 2) return '<p>אין נקודות GPS זמינות למסלול הזה.</p>';
  const line = points.map(point => point.join(',')).join(' ');
  const [startX, startY] = points[0], [endX, endY] = points.at(-1);
  return '<div class="garmin-route-map"><svg viewBox="-10 -10 340 180" role="img" aria-label="שרטוט מסלול הריצה לפי GPS של Garmin">' +
    '<g class="garmin-route-contours" aria-hidden="true">' +
    '<path d="M-40 110C-2 120 23 98 32 73S58 39 83 36 122 8 110-22 M-38 128C6 136 38 113 48 85S69 54 94 50 139 15 126-20 M-36 147C15 153 53 128 64 98S84 68 109 63 157 22 143-19 M-32 166C25 171 69 142 80 110S100 82 125 76 174 31 161-18 M-26 188C36 188 85 157 97 126S115 96 141 89 191 38 178-17"/>' +
    '<path d="M222 190C202 159 221 131 249 118S287 90 283 67 302 21 344 13 M239 193C221 165 236 143 260 132S304 99 301 73 317 38 348 31 M258 195C241 172 250 156 273 146S322 108 319 81 329 54 350 50 M277 196C263 180 270 166 288 159S341 119 338 89 340 71 353 66 M298 196C287 184 289 178 305 172S348 144 353 125"/>' +
    '</g>' +
    '<polyline class="garmin-route-line" points="' + line + '" pathLength="1"/>' +
    '<circle class="garmin-route-start" cx="' + startX + '" cy="' + startY + '" r="6"/>' +
    '<circle class="garmin-route-finish" cx="' + endX + '" cy="' + endY + '" r="4"/>' +
    '</svg><span class="garmin-route-map-caption">רקע להמחשה</span></div>' +
    '<div class="garmin-route-key"><span>התחלה</span><span>סיום</span></div>';
}

function resetGarminRouteAnimation(map) {
  if (!map) return;
  garminRouteObservers.get(map)?.disconnect();
  garminRouteObservers.delete(map);
  map.classList.remove('garmin-route-awaiting', 'garmin-route-drawing');
}

function loadGarminRouteImagery(map, bounds) {
  if (!map || !Array.isArray(bounds) || bounds.length !== 4 ||
      !bounds.every(value => Number.isFinite(value) && Math.abs(value) <= 20037509) ||
      bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) return;
  const image = new Image();
  image.className = 'garmin-route-imagery';
  image.alt = '';
  image.hidden = true;
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => {
    map.classList.add('garmin-route-with-imagery');
    image.hidden = false;
    map.querySelector('.garmin-route-map-caption').textContent = 'תצ״א';
    map.insertAdjacentHTML('afterend', '<small class="garmin-route-imagery-credit" dir="ltr">Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community</small>');
  }, { once: true });
  image.addEventListener('error', () => image.remove(), { once: true });
  map.prepend(image);
  const query = new URLSearchParams({
    bbox: bounds.map(value => value.toFixed(4)).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: '1020,540',
    format: 'jpg',
    f: 'image'
  });
  image.src = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?' + query;
}

function observeGarminRoute(map) {
  resetGarminRouteAnimation(map);
  if (!map || !map.closest('.garmin-route')?.open || typeof IntersectionObserver !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  map.classList.add('garmin-route-awaiting');
  // The observer belongs to this map and stops once the drawing has started.
  const observer = new IntersectionObserver(([entry]) => {
    if (garminRouteObservers.get(map) !== observer || !map.isConnected ||
        !entry.isIntersecting || entry.intersectionRatio < 0.25) return;
    observer.disconnect();
    garminRouteObservers.delete(map);
    map.classList.replace('garmin-route-awaiting', 'garmin-route-drawing');
  }, { threshold: 0.25 });
  garminRouteObservers.set(map, observer);
  observer.observe(map);
}

function garminRunClock(seconds) {
  const total = Math.round(seconds);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function garminRunChart(title, unit, samples, elapsedSec, isPace = false) {
  const points = (Array.isArray(samples) ? samples.slice(0, 360) : []).filter(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && point[0] >= 0 && point[1] > 0
  );
  if (points.length < 2) {
    return '<section class="garmin-run-chart"><h4>' + title + '</h4><p>אין מספיק מדידות להצגת הגרף.</p></section>';
  }
  const values = points.map(point => point[1]);
  const end = Math.max(1, Number.isFinite(elapsedSec) ? elapsedSec : 0, ...points.map(point => point[0]));
  const low = Math.max(0, Math.floor(Math.min(...values) - 2));
  const high = Math.ceil(Math.max(...values) + 2);
  const y = value => 18 + 96 * (isPace ? value - low : high - value) / (high - low);
  const x = seconds => 49 + 291 * seconds / end;
  const format = isPace ? garminRunClock : value => String(Math.round(value));
  const ticks = [low, (low + high) / 2, high].map(value =>
    '<line x1="49" x2="340" y1="' + y(value) + '" y2="' + y(value) + '"/>' +
    '<text x="43" y="' + (y(value) + 4) + '" text-anchor="end">' + format(value) + '</text>'
  ).join('');
  const gap = Math.max(30, end / 180);
  let trace = '', isolated = '';
  for (const [index, [time, value]] of points.entries()) {
    const previous = points[index - 1], next = points[index + 1];
    const connected = previous && time - previous[0] <= gap;
    const cx = x(time).toFixed(2), cy = y(value).toFixed(2);
    trace += (connected ? 'L' : 'M') + cx + ',' + cy;
    if (!connected && (!next || next[0] - time > gap)) {
      isolated += '<circle cx="' + cx + '" cy="' + cy + '" r="2.5"/>';
    }
  }
  return '<section class="garmin-run-chart' + (isPace ? ' garmin-run-chart-pace' : '') + '"><h4>' +
    title + ' <small>' + unit + '</small></h4><svg dir="ltr" viewBox="0 0 356 141" role="img" aria-label="' + title +
    ' לאורך הריצה, בטווח ' + format(Math.min(...values)) + ' עד ' + format(Math.max(...values)) + ' ' + unit + '">' +
    ticks + '<path d="' + trace + '"/>' + isolated +
    '<text x="49" y="134">0:00</text><text x="340" y="134" text-anchor="end">' + garminRunClock(end) + '</text>' +
    '</svg><div class="garmin-chart-axis">זמן מתחילת הריצה</div></section>';
}

function garminRunDetailsMarkup({ splits, heartRate, pace, elapsedSec }) {
  const positive = value => Number.isFinite(value) && value > 0;
  const rows = (Array.isArray(splits) ? splits.slice(0, 500) : []).map((lap, index) => {
    const { distanceM, durationSec, avgHr } = lap || {};
    const km = positive(distanceM) ? distanceM / 1000 : null;
    const duration = positive(durationSec) ? garminRunClock(durationSec) : '—';
    const lapPace = km && positive(durationSec) ? garminRunClock(durationSec / km) : '—';
    return '<tr><th scope="row">' + (index + 1) + '</th><td>' + (km ? km.toFixed(2) : '—') +
      '</td><td>' + duration + '</td><td>' + lapPace + '</td><td>' + (positive(avgHr) ? Math.round(avgHr) : '—') + '</td></tr>';
  }).join('');
  return '<details class="garmin-run-details"><summary>ספליטים וגרפים</summary>' +
    '<section class="garmin-run-splits"><h4>הקפות Garmin</h4>' + (rows ?
      '<div class="garmin-splits-scroll"><table aria-label="הקפות Garmin"><thead><tr>' +
      '<th scope="col">הקפה</th><th scope="col">ק״מ</th><th scope="col">זמן</th><th scope="col">דק׳/ק״מ</th><th scope="col">דופק ממוצע</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p>אין הקפות שמורות לריצה הזו.</p>') +
    '</section><div class="garmin-run-charts">' + garminRunChart('דופק', 'פעימות לדקה', heartRate, elapsedSec) +
    garminRunChart('קצב', 'דקות לק״מ', pace, elapsedSec, true) + '</div></details>';
}

async function loadGarminRoute(details) {
  const user = currentUser;
  const id = details.dataset.garminRoute;
  const body = details.querySelector('.garmin-route-body');
  if (!user || !body || !details.open || body.dataset.loaded) return;
  body.dataset.loaded = 'true';
  body.textContent = 'טוען מסלול מ־Garmin…';
  const key = user.uid + ':' + id;
  try {
    if (!garminRouteCache.has(key)) {
      if (garminRouteCache.size >= 24) garminRouteCache.delete(garminRouteCache.keys().next().value);
      const request = (async () => {
        const token = await user.getIdToken();
        const response = await fetch('/.netlify/functions/garmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ action: 'route', activityId: id }),
          signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw Error('Route request failed');
        return response.json();
      })();
      garminRouteCache.set(key, request);
      request.catch(() => {
        if (garminRouteCache.get(key) === request) garminRouteCache.delete(key);
      });
    }
    const activity = await garminRouteCache.get(key);
    if (currentUser === user && details.isConnected) {
      body.innerHTML = garminRouteDrawing(activity.points) + garminRunDetailsMarkup(activity);
      const map = body.querySelector('.garmin-route-map');
      loadGarminRouteImagery(map, activity.imageryBounds);
      observeGarminRoute(map);
    }
  } catch {
    if (currentUser === user && details.isConnected) {
      body.textContent = 'לא הצלחנו לטעון את המסלול. סגור ופתח כדי לנסות שוב.';
      delete body.dataset.loaded;
    }
  }
}

document.addEventListener('toggle', event => {
  const details = event.target;
  if (!details.matches?.('details[data-garmin-route]')) return;
  const map = details.querySelector('.garmin-route-map');
  if (details.open) {
    if (map) observeGarminRoute(map);
    else loadGarminRoute(details);
  } else {
    resetGarminRouteAnimation(map);
  }
}, true);
