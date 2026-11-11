import garmin from './garmin.js';
import firebase from '../lib/jarvis-firebase.cjs';

export const config = { schedule: '*/10 * * * *' };

export default async function syncGarminRuns() {
  const { GARMIN_PERSONAL_API_KEY: key, GARMIN_ALLOWED_UID: uid, GARMIN_RUN_SYNC_ENABLED: enabled } = process.env;
  if (enabled !== 'true' || !key || !uid || uid.includes('/')) return new Response(null, { status: 204 });
  try {
    const { store } = firebase.runtime();
    const checkedAt = Date.now();
    const { runs } = await garmin.fetchRuns(key);
    await store.transaction(async tx => {
      const path = 'users/' + uid;
      const user = await tx.get(path);
      if (!user || (user.garmin_run_sync?.checkedAt || 0) >= checkedAt) return;
      tx.merge(path, { garmin_run_sync: { checkedAt, runs } });
    });
    return new Response(null, { status: 204 });
  } catch {
    console.error('garmin_run_sync_failed');
    return new Response(null, { status: 502 });
  }
}
