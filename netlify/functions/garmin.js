const { normalizeRuns } = require('../lib/garmin-runs.cjs');
const BASE = 'https://personal.connectapi.garmin.com';
let cachedToken = null;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Garmin-Connector-Version': '3' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10000), redirect: 'error' });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  const { FIREBASE_API_KEY, GARMIN_PERSONAL_API_KEY, GARMIN_ALLOWED_UID } = process.env;
  if (!FIREBASE_API_KEY || !GARMIN_PERSONAL_API_KEY || !GARMIN_ALLOWED_UID) {
    return reply(503, { error: 'חיבור Garmin עדיין לא הוגדר בשרת.' });
  }
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'נדרשת כניסה לחשבון.' });
  try {
    const authResponse = await request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: authorization.slice(7) })
    });
    if (!authResponse.ok) return reply(401, { error: 'יש להיכנס שוב לחשבון.' });
    const account = await authResponse.json();
    if (account.users?.[0]?.localId !== GARMIN_ALLOWED_UID) return reply(403, { error: 'חיבור Garmin אינו מוגדר לחשבון הזה.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid request' });
    if (body.action && !['wellness','runs','route'].includes(body.action)) return reply(400, { error: 'Invalid action' });
    if (body.action === 'route' && (typeof body.activityId !== 'string' || !/^\d{1,20}$/.test(body.activityId))) return reply(400, { error: 'Invalid activity' });
    if (body.action === 'wellness' && (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0,10) !== body.date)) return reply(400, { error: 'Invalid date' });
    const start = body.start ?? 0;
    if (!Number.isInteger(start) || start < 0 || start > 10000) return reply(400, { error: 'Invalid page' });
    const token = await garminToken(GARMIN_PERSONAL_API_KEY);
    if (body.action === 'route') {
      const response = await request(BASE + '/download-service/files/activity/' + body.activityId, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if ([204, 404].includes(response.status)) return reply(200, { points: [] });
      if (!response.ok) {
        if (response.status === 401) cachedToken = null;
        return reply(502, { error: 'Garmin לא הצליחה לספק את המסלול כרגע.' });
      }
      const { detailsFromActivity } = require('../lib/garmin-route.cjs');
      return reply(200, await detailsFromActivity(response));
    }
    if (body.action === 'wellness') {
      const date = body.date;
      // Fixed endpoint allowlist; never accept arbitrary provider URLs from callers.
      const paths = {
        sleep: `/sleep-service/sleep/dailySleep?date=${date}`,
        summary: `/usersummary-service/v2/dailysummaries?startDate=${date}&endDate=${date}`,
        steps: `/usersummary-service/stats/steps/daily/${date}/${date}`,
        hrv: `/hrv-service/hrv/${date}`,
        bodyBattery: `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`,
        heartRate: `/wellness-service/wellness/dailyHeartRate?date=${date}`,
        activities: `/activitylist-service/activities/search/activities?start=0&limit=20&startDate=${date}&endDate=${date}`
      };
      const sections = await Promise.all(Object.entries(paths).map(async ([name,path]) => {
        try {
          const response = await request(BASE + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
          if (!response.ok) {
            if (response.status === 401) cachedToken = null;
            return [name, { status: response.status === 404 || response.status === 204 ? 'empty' : 'error', httpStatus: response.status }];
          }
          const text = await response.text();
          const data = text.trim() ? JSON.parse(text) : null;
          return [name, { status: data === null || (Array.isArray(data) && !data.length) ? 'empty' : 'ok', data }];
        } catch { return [name, { status: 'error' }]; }
      }));
      return reply(200, { date, fetchedAt: new Date().toISOString(), source: 'Garmin', sections: Object.fromEntries(sections) });
    }
    return reply(200, await fetchRuns(GARMIN_PERSONAL_API_KEY, start, token));
  } catch (error) {
    if (error instanceof GarminError) return reply(502, { error: error.message });
    return reply(502, { error: 'תקלה בקבלת הנתונים. נסה שוב מאוחר יותר.' });
  }
};

class GarminError extends Error {}
async function garminToken(GARMIN_PERSONAL_API_KEY) {
  // Tokens and the personal key never leave the server. Cache only in process memory.
  if (!cachedToken || cachedToken.expires < Date.now() || cachedToken.key !== GARMIN_PERSONAL_API_KEY) {
    const tokenResponse = await request(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`, {
      method: 'POST', headers: { Authorization: `ApiKey ${GARMIN_PERSONAL_API_KEY}` }
    });
    if (!tokenResponse.ok) throw new GarminError('Garmin לא אישר את המפתח. בדוק את תוקפו בהגדרות השרת.');
    // Garmin's official endpoint returns a plain-text JWT, not OAuth JSON.
    const token = (await tokenResponse.text()).trim();
    let expires;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      expires = Number(payload.exp) * 1000;
    } catch { /* Reject an unexpected response without exposing it. */ }
    if (!Number.isFinite(expires) || expires <= Date.now() + 60000) {
      throw new GarminError('התקבלה תשובת הזדהות לא תקינה מ־Garmin. נסה שוב מאוחר יותר.');
    }
    cachedToken = { value: token, key: GARMIN_PERSONAL_API_KEY, expires: expires - 60000 };
  }
  return cachedToken.value;
}
async function fetchRuns(key, start = 0, token) {
  const access = token || await garminToken(key);
  const params = new URLSearchParams({ start, limit: 50, activityType: "running" });
  const response = await request(BASE + "/activitylist-service/activities/search/activities?" + params, {
    headers: { Authorization: "Bearer " + access, Accept: "application/json" }
  });
  if (!response.ok) {
    if (response.status === 401) cachedToken = null;
    throw new GarminError("לא ניתן לקבל ריצות מ־Garmin כרגע. נסה שוב מאוחר יותר.");
  }
  const activities = response.status === 204 ? [] : await response.json();
  const runs = normalizeRuns(activities);
  return { runs, skipped: activities.length - runs.length, nextStart: activities.length === 50 ? start + 50 : null };
}
exports.fetchRuns = fetchRuns;
