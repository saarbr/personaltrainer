let garminRunSync = { runs: [] };

function stopGarminRunSync() {
  garminRunSync.unsubscribe?.();
  clearInterval(garminRunSync.timer);
  garminRunSync = { runs: [] };
}

function startGarminRunSync(user) {
  stopGarminRunSync();
  const state = garminRunSync;
  state.unsubscribe = db.collection('users').doc(user.uid).onSnapshot(snapshot => {
    const stored = snapshot.data()?.garmin_run_sync;
    if (state === garminRunSync && stored?.checkedAt > (state.checkedAt || 0)) {
      showGarminRuns(stored.runs, stored.checkedAt);
    }
  }, () => {});
  refreshGarminRuns();
  state.timer = setInterval(() => {
    if (!document.hidden && !state.unavailable) refreshGarminRuns();
  }, 5 * 60 * 1000);
}

function showGarminRuns(runs, checkedAt) {
  if (!Array.isArray(runs)) return;
  const changed = JSON.stringify(garminRunSync.runs) !== JSON.stringify(runs);
  garminRunSync.runs = runs;
  garminRunSync.checkedAt = checkedAt;
  if (changed && currentPg === 'dash') renderDash();
  if (changed && currentPg === 'fitness') renderFitness();
}

async function refreshGarminRuns(manual = false) {
  const state = garminRunSync;
  const user = currentUser;
  if (!user || state.busy || (!manual && state.unavailable)) return;
  state.busy = true;
  const status = document.getElementById('garmin-status');
  if (manual && status) status.textContent = 'בודק ריצות ב־Garmin…';
  try {
    const token = await user.getIdToken();
    const checkedAt = Date.now();
    const response = await fetch('/.netlify/functions/garmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ action: 'runs' }),
      signal: AbortSignal.timeout(25000)
    });
    const result = await response.json();
    if (garminRunSync !== state || currentUser?.uid !== user.uid) return;
    if (!response.ok) {
      state.unavailable = response.status === 403 || response.status === 503;
      throw Error(result.error || 'הסנכרון נכשל.');
    }
    state.unavailable = false;
    if (checkedAt >= (state.checkedAt || 0)) showGarminRuns(result.runs, checkedAt);
    if (manual && status) status.textContent = result.runs.length ? 'הריצות האחרונות מעודכנות.' : 'Garmin עדיין לא החזירה ריצות.';
  } catch (error) {
    if (manual && garminRunSync === state && status) status.textContent = error.message || 'הסנכרון נכשל.';
  } finally {
    state.busy = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - (garminRunSync.checkedAt || 0) > 60000) refreshGarminRuns();
});

function recentGarminRuns() {
  const byId = new Map();
  for (const run of [...RUNS.filter(run => run.garminId), ...garminRunSync.runs]) {
    if (/^\d+$/.test(String(run?.garminId)) && typeof run.date === 'string' && Number.isFinite(run.km)) {
      byId.set(String(run.garminId), run);
    }
  }
  return [...byId.values()].sort((a, b) => (b.startedAt || b.date).localeCompare(a.startedAt || a.date));
}

function garminCompletedWorkout(date, workouts, index) {
  return workouts[index]?.type === 'run' &&
    workouts.filter(workout => workout.type === 'run').length === 1 &&
    recentGarminRuns().some(run => run.date === date);
}

function completedWorkoutOn(date, day) {
  const workouts = getEffectiveWorkouts(weekKeyOf(date), day);
  return workouts.some((_, index) =>
    !!COMP[date + '-' + day + (index ? '-' + index : '')] || garminCompletedWorkout(date, workouts, index)
  );
}

function renderLatestGarminRun() {
  const run = recentGarminRuns()[0];
  if (!run) return '';
  const duration = run.durationSec ? Math.round(run.durationSec) : null;
  const metrics = [
    [run.km.toFixed(2), 'ק״מ'],
    ...(duration ? [[fmtPace(duration), 'זמן (דק׳:שנ׳)']] : []),
    ...(run.paceSec ? [[fmtPace(Math.round(run.paceSec)), 'דק׳ לק״מ']] : []),
    ...(run.avgHr ? [[Math.round(run.avgHr), 'דופק ממוצע']] : []),
    ...(run.elevationM > 0 ? [[Math.round(run.elevationM), 'מ׳ טיפוס']] : [])
  ];
  return '<section class="card garmin-run-summary" aria-label="הריצה האחרונה מ־Garmin">' +
    '<div class="garmin-run-heading"><div><div class="mw-eyebrow">Garmin Connect · ' + esc(run.date) +
    '</div><h2>' + esc(run.name || 'הריצה האחרונה') + '</h2></div>' +
    '<a href="https://connect.garmin.com/modern/activity/' + run.garminId +
    '" target="_blank" rel="noopener noreferrer">לפרטי הריצה ↗</a></div>' +
    '<div class="garmin-run-metrics">' + metrics.map(([value, label]) =>
      '<div><strong class="num" dir="ltr">' + value + '</strong><span>' + label + '</span></div>'
    ).join('') + '</div></section>';
}
