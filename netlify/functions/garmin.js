const BASE = 'https://personal.connectapi.garmin.com';
let cachedToken = null;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Garmin-Connector-Version': '2' };
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
    const start = body.start ?? 0;
    if (!Number.isInteger(start) || start < 0 || start > 10000) return reply(400, { error: 'Invalid page' });
    // Tokens and the personal key never leave the server. Cache only in process memory.
    if (!cachedToken || cachedToken.expires < Date.now() || cachedToken.key !== GARMIN_PERSONAL_API_KEY) {
      const tokenResponse = await request(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`, {
        method: 'POST', headers: { Authorization: `ApiKey ${GARMIN_PERSONAL_API_KEY}` }
      });
      if (!tokenResponse.ok) return reply(502, { error: 'Garmin לא אישר את המפתח. בדוק את תוקפו בהגדרות השרת.' });
      // Garmin's official endpoint returns a plain-text JWT, not OAuth JSON.
      const token = (await tokenResponse.text()).trim();
      let expires;
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        expires = Number(payload.exp) * 1000;
      } catch { /* Reject an unexpected response without exposing it. */ }
      if (!Number.isFinite(expires) || expires <= Date.now() + 60000) {
        return reply(502, { error: 'התקבלה תשובת הזדהות לא תקינה מ־Garmin. נסה שוב מאוחר יותר.' });
      }
      cachedToken = { value: token, key: GARMIN_PERSONAL_API_KEY, expires: expires - 60000 };
    }
    const response = await request(`${BASE}/activitylist-service/activities/search/activities?start=${start}&limit=50&activityType=running`, {
      headers: { Authorization: `Bearer ${cachedToken.value}`, Accept: 'application/json' }
    });
    if (!response.ok) {
      if (response.status === 401) cachedToken = null;
      return reply(502, { error: 'לא ניתן לקבל ריצות מ־Garmin כרגע. נסה שוב מאוחר יותר.' });
    }
    const activities = await response.json();
    if (!Array.isArray(activities)) throw new Error('Unexpected activity response');
    const runs = activities.filter(a => a.activityId && Number.isFinite(a.distance) && a.distance > 0 && Number.isFinite(a.averageSpeed) && a.averageSpeed > 0 && /^\d{4}-\d{2}-\d{2}/.test(a.startTimeLocal || '')).map(a => ({
      garminId: String(a.activityId), date: a.startTimeLocal.slice(0, 10),
      km: a.distance / 1000, paceSec: 1000 / a.averageSpeed,
      avgHr: Number.isFinite(a.averageHR) ? a.averageHR : null,
      name: typeof a.activityName === 'string' ? a.activityName : '',
      source: 'Garmin', device: typeof a.deviceName === 'string' ? a.deviceName : null
    }));
    return reply(200, { runs, skipped: activities.length - runs.length, nextStart: activities.length === 50 ? start + 50 : null });
  } catch {
    // Never echo upstream bodies or credentials into responses/logs.
    return reply(502, { error: 'תקלה בקבלת הנתונים. נסה שוב מאוחר יותר.' });
  }
};
