import React from "react";
import { Chart } from "./charts/index.tsx";
import { useUITheme } from "./okr-ui.jsx";
export function OkrActivityChart({
  series,
  type = "line",
  height = 250,
  label
}) {
  const theme = useUITheme();
  return <div className="okr-activity-chart" aria-label={label}>
    <Chart series={series} type={type} height={height} theme={theme} />
  </div>;
}
