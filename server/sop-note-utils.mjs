function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
export function hasHttpLink(value) {
  return /https?:\/\//i.test(String(value || ""));
}
export function markdownDisplayText(value) {
  return normalizeText(String(value || "").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, "$1"));
}
export function resolveLinkedExecutionNote(executionNote, eventNote) {
  const current = normalizeText(executionNote);
  const source = normalizeText(eventNote);
  if (!source) return current || null;
  if (!hasHttpLink(source)) return current || source;
  if (!current) return source;
  if (hasHttpLink(current)) return current;
  return markdownDisplayText(source) === current ? source : current;
}
