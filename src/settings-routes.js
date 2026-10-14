export const settingsThemeIds = Object.freeze(["appearance", "task", "navigation", "lists", "calendar", "sop", "analytics", "changelog", "system-log"]);
export function settingsRoute(activeTab) {
  if (!activeTab || activeTab === "home") return {
    level: "home",
    themeId: null,
    itemId: null
  };
  const themeId = settingsThemeIds.includes(activeTab) ? activeTab : settingsThemeIds[0];
  return {
    level: "theme",
    themeId,
    itemId: null
  };
}
export function routeHash(route) {
  if (route.level === "home") return "#settings";
  if (route.level === "theme") return `#settings/${route.themeId}`;
  return `#settings/${route.themeId}/${route.itemId}`;
}
export function settingsRouteFromHash(hashValue) {
  const match = String(hashValue || "").match(/^#settings(?:\/([^/]+))?(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  if (!match[1]) return {
    level: "home",
    themeId: null,
    itemId: null
  };
  if (!settingsThemeIds.includes(match[1])) return {
    level: "home",
    themeId: null,
    itemId: null
  };
  return match[2] ? {
    level: "item",
    themeId: match[1],
    itemId: match[2]
  } : {
    level: "theme",
    themeId: match[1],
    itemId: null
  };
}
