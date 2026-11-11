const garminRouteCache = new Map();

function garminRouteMarkup(activityId, open = false) {
  const id = String(activityId);
  if (!/^\d{1,20}$/.test(id)) return '';
  return '<details class="garmin-route" data-garmin-route="' + id + '"' + (open ? ' open' : '') +
    '><summary>מסלול הריצה</summary><div class="garmin-route-body" aria-live="polite"></div></details>';
}

function garminRouteDrawing(points) {
  const valid = Array.isArray(points) && points.length <= 400 && points.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isInteger) &&
    point[0] >= 0 && point[0] <= 320 && point[1] >= 0 && point[1] <= 160
  );
  if (!valid || points.length < 2) return '<p>אין נקודות GPS זמינות למסלול הזה.</p>';
  const line = points.map(point => point.join(',')).join(' ');
  const [startX, startY] = points[0], [endX, endY] = points.at(-1);
  return '<svg viewBox="0 0 320 160" role="img" aria-label="שרטוט מסלול הריצה לפי GPS של Garmin">' +
    '<polyline points="' + line + '" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + startX + '" cy="' + startY + '" r="5" fill="#9ce8cb"/>' +
    '<circle cx="' + endX + '" cy="' + endY + '" r="5" fill="#ffa783" stroke="#272d35" stroke-width="1.5"/>' +
    '</svg><div class="garmin-route-key"><span>התחלה</span><span>סיום</span></div>';
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
        return (await response.json()).points;
      })();
      garminRouteCache.set(key, request);
      request.catch(() => {
        if (garminRouteCache.get(key) === request) garminRouteCache.delete(key);
      });
    }
    const points = await garminRouteCache.get(key);
    if (currentUser === user && details.isConnected) body.innerHTML = garminRouteDrawing(points);
  } catch {
    if (currentUser === user && details.isConnected) {
      body.textContent = 'לא הצלחנו לטעון את המסלול. סגור ופתח כדי לנסות שוב.';
      delete body.dataset.loaded;
    }
  }
}

document.addEventListener('toggle', event => {
  if (event.target.matches?.('details[data-garmin-route]')) loadGarminRoute(event.target);
}, true);
