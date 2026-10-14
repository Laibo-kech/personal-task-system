let analyticsPage = "";
export function setAnalyticsPage(page) {
  analyticsPage = String(page || "").slice(0, 80);
}
export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(analyticsPage ? {
        "X-Analytics-Page": analyticsPage
      } : {}),
      ...options.headers
    },
    ...options
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "请求失败");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}
export function trackAnalyticsEvent(event) {
  const payload = {
    eventUuid: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    page: analyticsPage,
    result: "success",
    ...event
  };
  fetch("/api/analytics/events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }).catch(() => {});
}
