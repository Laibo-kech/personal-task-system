export function createSettingsQueue({
  initial = {},
  write,
  onChange = () => {}
}) {
  let confirmed = initial;
  let pending = [];
  let tail = Promise.resolve();
  const value = () => Object.assign({}, confirmed, ...pending.map(entry => entry.patch));
  const publish = () => onChange(value(), pending.length);
  return {
    value,
    replace(next) {
      confirmed = next || {};
      publish();
    },
    save(patch) {
      const entry = {
        patch
      };
      pending.push(entry);
      publish();
      const request = tail.then(async () => {
        try {
          const result = await write(patch, confirmed);
          confirmed = result || {
            ...confirmed,
            ...patch
          };
          return confirmed;
        } finally {
          pending = pending.filter(item => item !== entry);
          publish();
        }
      });
      tail = request.catch(() => {});
      return request;
    }
  };
}
export function validateSettingsPatch(kind, patch, current = {}) {
  const next = {
    ...current,
    ...patch
  };
  for (const key of ['generation_time', 'maintenance_time', 'default_start_time', 'light_start', 'dark_start']) {
    if (key in patch && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch[key]))) return '请选择有效的时间';
  }
  if (kind === 'calendar' && ('display_start_time' in patch || 'display_end_time' in patch)) {
    const minutes = time => {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(time) && time !== '24:00:00') return NaN;
      const [hour, minute] = time.split(':').map(Number);
      return hour * 60 + minute;
    };
    const start = minutes(next.display_start_time || '06:00:00');
    const end = minutes(next.display_end_time || '24:00:00');
    if (!Number.isFinite(start + end) || start >= end) return '结束时间必须晚于开始时间';
  }
  if ('default_duration_minutes' in patch && !(Number(patch.default_duration_minutes) > 0)) return '持续时间必须大于 0';
  if ('default_reminder_minutes' in patch && !(Number(patch.default_reminder_minutes) >= 0)) return '提醒时间不能小于 0';
  return '';
}
