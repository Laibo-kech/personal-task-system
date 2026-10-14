export const TASK_COMPLETION_EXIT_MS = 240;
export const TASK_COMPLETION_REDUCED_EXIT_MS = 80;
export const TASK_COMPLETION_REFLOW_MS = 210;
export const TASK_COMPLETION_REFLOW_EASING = "linear";
export function prefersReducedTaskMotion(windowRef = globalThis.window) {
  return Boolean(windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}
export function taskCompletionExitDuration(windowRef = globalThis.window) {
  return prefersReducedTaskMotion(windowRef) ? TASK_COMPLETION_REDUCED_EXIT_MS : TASK_COMPLETION_EXIT_MS;
}
export function captureTaskRowPositions(rowNodes) {
  const positions = new Map();
  for (const [taskId, node] of rowNodes || []) {
    if (!node?.getBoundingClientRect) continue;
    const top = Number(node.getBoundingClientRect().top);
    if (Number.isFinite(top)) positions.set(taskId, top);
  }
  return positions;
}
export function animateTaskRowReflow(previousPositions, rowNodes, {
  duration = TASK_COMPLETION_REFLOW_MS,
  easing = TASK_COMPLETION_REFLOW_EASING,
  reduceMotion = prefersReducedTaskMotion()
} = {}) {
  if (reduceMotion || !previousPositions?.size) return [];
  const animations = [];
  for (const [taskId, node] of rowNodes || []) {
    const previousTop = previousPositions.get(taskId);
    if (!Number.isFinite(previousTop) || !node?.getBoundingClientRect || !node?.animate) continue;
    const currentTop = Number(node.getBoundingClientRect().top);
    const delta = previousTop - currentTop;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) continue;
    animations.push(node.animate([{
      transform: `translate3d(0, ${delta}px, 0)`
    }, {
      transform: "translate3d(0, 0, 0)"
    }], {
      duration,
      easing
    }));
  }
  return animations;
}
