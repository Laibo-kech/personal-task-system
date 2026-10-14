export const COMPLETION_PARTICLE_COUNT = 34;
export const COMPLETION_PARTICLE_LIFETIME_MS = 980;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEFAULT_ACCENT = "#22a06b";
const DEFAULT_PALETTE = ["#22a06b", "#2f6fec", "#23a8f2", "#7c5cff", "#ff9f1c", "#ff5d73"];
function safeAccentColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : DEFAULT_ACCENT;
}
export function buildCompletionParticleSpecs(count = COMPLETION_PARTICLE_COUNT, accentColor = DEFAULT_ACCENT) {
  const total = Math.max(12, Math.min(Number(count) || COMPLETION_PARTICLE_COUNT, 48));
  const palette = [safeAccentColor(accentColor), ...DEFAULT_PALETTE];
  return Array.from({
    length: total
  }, (_, index) => {
    const angle = index * GOLDEN_ANGLE - Math.PI / 2;
    const band = index % 7;
    const distance = 31 + band * 6 + index * 11 % 9;
    const column = index % 6;
    const row = Math.floor(index / 6);
    return {
      color: palette[index % palette.length],
      delay: index % 6 * 9,
      duration: 610 + index % 5 * 34,
      originX: Math.round((column - 2.5) * 2.2 * 10) / 10,
      originY: Math.round((row - 2.5) * 2.2 * 10) / 10,
      radius: index % 5 === 0 ? "50%" : index % 3 === 0 ? "2px" : "1px",
      rotation: index * 73 % 280 - 140,
      size: 2.5 + index % 4 * 0.8,
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance + 13 + index % 4 * 2)
    };
  });
}
function anchorRect(anchor) {
  if (anchor?.getBoundingClientRect) return anchor.getBoundingClientRect();
  return anchor;
}
export function launchCompletionParticles(anchor, options = {}) {
  const documentRef = options.documentRef || globalThis.document;
  const windowRef = documentRef?.defaultView || globalThis.window;
  let enabled = options.enabled === true;
  try {
    enabled ||= windowRef?.localStorage?.getItem("life-task-okr:completion-celebration") === "true";
  } catch {}
  if (!enabled) return null;
  const reduceMotion = options.reduceMotion ?? windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion || !documentRef?.body) return null;
  const rect = anchorRect(anchor);
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
  const burst = documentRef.createElement("span");
  burst.className = "completion-particle-burst";
  burst.setAttribute("aria-hidden", "true");
  burst.dataset.particleCount = String(COMPLETION_PARTICLE_COUNT);
  burst.style.left = `${rect.left + rect.width / 2}px`;
  burst.style.top = `${rect.top + rect.height / 2}px`;
  const ring = documentRef.createElement("span");
  ring.className = "completion-burst-ring";
  burst.append(ring);
  const check = documentRef.createElement("span");
  check.className = "completion-burst-check";
  burst.append(check);
  for (const [index, spec] of buildCompletionParticleSpecs(COMPLETION_PARTICLE_COUNT, options.accentColor).entries()) {
    const particle = documentRef.createElement("i");
    particle.className = "completion-particle";
    particle.dataset.particleIndex = String(index);
    particle.style.setProperty("--particle-color", spec.color);
    particle.style.setProperty("--particle-delay", `${spec.delay}ms`);
    particle.style.setProperty("--particle-duration", `${spec.duration}ms`);
    particle.style.setProperty("--particle-origin-x", `${spec.originX}px`);
    particle.style.setProperty("--particle-origin-y", `${spec.originY}px`);
    particle.style.setProperty("--particle-radius", spec.radius);
    particle.style.setProperty("--particle-rotate", `${spec.rotation}deg`);
    particle.style.setProperty("--particle-size", `${spec.size}px`);
    particle.style.setProperty("--particle-x", `${spec.x}px`);
    particle.style.setProperty("--particle-y", `${spec.y}px`);
    burst.append(particle);
  }
  documentRef.body.append(burst);
  const requestFrame = windowRef?.requestAnimationFrame?.bind(windowRef) || (callback => setTimeout(callback, 0));
  requestFrame(() => {
    if (burst.isConnected) burst.classList.add("is-running");
  });
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    burst.remove();
  };
  const schedule = windowRef?.setTimeout?.bind(windowRef) || setTimeout;
  schedule(cleanup, COMPLETION_PARTICLE_LIFETIME_MS);
  return {
    cleanup,
    element: burst,
    particleCount: COMPLETION_PARTICLE_COUNT
  };
}
