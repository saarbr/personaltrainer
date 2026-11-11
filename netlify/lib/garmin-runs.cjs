function normalizeRuns(activities) {
  if (!Array.isArray(activities)) throw Error('Unexpected Garmin activity response');
  return activities.flatMap(activity => {
    const { activityId, distance, averageSpeed, duration, movingDuration, startTimeLocal } = activity || {};
    if (!/^\d+$/.test(String(activityId)) || !Number.isFinite(distance) || distance <= 0 ||
        typeof startTimeLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(startTimeLocal)) return [];
    const date = startTimeLocal.slice(0, 10);
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return [];
    const positive = value => Number.isFinite(value) && value > 0;
    const seconds = positive(duration) ? duration : positive(movingDuration) ? movingDuration : null;
    const pace = positive(averageSpeed) ? 1000 / averageSpeed : seconds ? seconds / (distance / 1000) : null;
    return [{
      garminId: String(activityId), date, startedAt: startTimeLocal,
      km: distance / 1000, paceSec: Number.isFinite(pace) ? pace : null, durationSec: seconds,
      avgHr: positive(activity.averageHR) ? activity.averageHR : null,
      elevationM: Number.isFinite(activity.elevationGain) && activity.elevationGain >= 0 ? activity.elevationGain : null,
      name: typeof activity.activityName === 'string' ? activity.activityName.slice(0, 200) : '',
      device: typeof activity.deviceName === 'string' ? activity.deviceName.slice(0, 100) : null,
      source: 'Garmin'
    }];
  });
}

module.exports = { normalizeRuns };
