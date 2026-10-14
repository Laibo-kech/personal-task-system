export const chartMotionDurations = Object.freeze({
  line: 420,
  bar: 380,
  doughnut: 380,
  kpi: 300,
  update: 180
});
export function chartAnimationOptions(type, reducedMotion = false, updating = false) {
  if (reducedMotion) return {
    duration: 0
  };
  if (updating) return {
    duration: chartMotionDurations.update,
    easing: "easeOutQuart"
  };
  if (type === "bar") {
    return {
      duration: chartMotionDurations.bar,
      easing: "easeOutQuart",
      delay: context => context.type === "data" ? Math.min(context.dataIndex * 10, 80) : 0
    };
  }
  return {
    duration: chartMotionDurations[type] || chartMotionDurations.line,
    easing: "easeOutQuart"
  };
}
