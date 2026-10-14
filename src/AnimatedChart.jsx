import React, { useEffect, useMemo, useRef, useState } from "react";
import { chartAnimationOptions, chartMotionDurations } from "./chart-motion.js";
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener?.("change", change);
    return () => media.removeEventListener?.("change", change);
  }, []);
  return reduced;
}
function useEnteredViewport(ref) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (entered || !ref.current) return undefined;
    if (!("IntersectionObserver" in window)) {
      setEntered(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setEntered(true);
      observer.disconnect();
    }, {
      rootMargin: "80px 0px",
      threshold: 0.08
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [entered, ref]);
  return entered;
}
export function AnimatedChart({
  ariaLabel,
  data,
  height = 260,
  options = {},
  type = "line"
}) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const firstRenderRef = useRef(true);
  const entered = useEnteredViewport(hostRef);
  const reducedMotion = useReducedMotion();
  const signature = useMemo(() => JSON.stringify(data), [data]);
  useEffect(() => {
    if (!entered || !canvasRef.current) return undefined;
    let cancelled = false;
    import("chart.js/auto").then(({
      default: Chart
    }) => {
      if (cancelled || !canvasRef.current) return;
      if (!chartRef.current) {
        chartRef.current = new Chart(canvasRef.current, {
          type,
          data,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimationOptions(type, reducedMotion, false),
            interaction: {
              intersect: false,
              mode: "index"
            },
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                padding: 10,
                cornerRadius: 8
              },
              ...(options.plugins || {})
            },
            ...options
          }
        });
        firstRenderRef.current = false;
        return;
      }
      chartRef.current.data = data;
      chartRef.current.options = {
        ...chartRef.current.options,
        ...options,
        animation: chartAnimationOptions(type, reducedMotion, !firstRenderRef.current)
      };
      chartRef.current.update();
    });
    return () => {
      cancelled = true;
    };
  }, [entered, signature, type, reducedMotion]);
  useEffect(() => () => {
    chartRef.current?.destroy();
    chartRef.current = null;
  }, []);
  return <div className="animated-chart" ref={hostRef} style={{
    height
  }}>
    <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
  </div>;
}
export function AnimatedKpi({
  value,
  suffix = ""
}) {
  const numeric = Number(value || 0);
  const hostRef = useRef(null);
  const entered = useEnteredViewport(hostRef);
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(reducedMotion ? numeric : 0);
  useEffect(() => {
    if (!entered || reducedMotion) {
      setShown(numeric);
      return undefined;
    }
    const started = performance.now();
    let frame;
    const step = now => {
      const progress = Math.min(1, (now - started) / chartMotionDurations.kpi);
      const eased = 1 - Math.pow(1 - progress, 4);
      setShown(Math.round(numeric * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [entered, numeric, reducedMotion]);
  return <span ref={hostRef}>{shown.toLocaleString("zh-CN")}{suffix}</span>;
}
