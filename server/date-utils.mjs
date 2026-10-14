const EXCEL_UNIX_EPOCH_DAYS = 25569;
const DAY_MS = 86400000;
export function excelSerialToIso(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 20000 || serial > 100000) {
    return null;
  }
  return new Date((serial - EXCEL_UNIX_EPOCH_DAYS) * DAY_MS).toISOString();
}
export function isPlausibleTaskDate(value, now = new Date()) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const year = parsed.getUTCFullYear();
  return year >= 2000 && year <= now.getUTCFullYear() + 1;
}
