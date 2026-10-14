const DAY_MS = 86_400_000;
export function calendarDateKey(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
export function miniMonthCells(monthValue, todayValue = new Date()) {
  const month = monthValue instanceof Date ? monthValue : new Date(monthValue);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getTime() - mondayOffset * DAY_MS);
  const today = calendarDateKey(todayValue);
  return Array.from({
    length: 42
  }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    const key = calendarDateKey(date);
    return {
      date,
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      today: key === today
    };
  });
}
export function monthApiRange(monthValue) {
  const cells = miniMonthCells(monthValue);
  const last = cells[cells.length - 1].date;
  return {
    from: cells[0].key,
    to: calendarDateKey(new Date(last.getTime() + DAY_MS))
  };
}
export function nextDaysRange(days = 90, now = new Date()) {
  return {
    from: calendarDateKey(now),
    to: calendarDateKey(new Date(now.getTime() + Math.max(1, days) * DAY_MS))
  };
}
export function nearestUpcoming(items, now = new Date(), limit = 5) {
  const threshold = now.getTime();
  return [...(Array.isArray(items) ? items : [])].filter(item => {
    const time = new Date(item.startAt).getTime();
    return Number.isFinite(time) && time >= threshold;
  }).sort((left, right) => new Date(left.startAt) - new Date(right.startAt)).slice(0, limit);
}
