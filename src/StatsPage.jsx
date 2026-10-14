import { OkrSelect } from "./okr-ui.jsx";
import { OkrButton, OkrInput } from "./okr-ui.jsx";
import React, { useEffect, useId, useMemo, useState } from "react";
import { BarChart3, CalendarRange, CircleDot, Flame, Gauge, LoaderCircle, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "./api.js";
import { AnimatedChart, AnimatedKpi } from "./AnimatedChart.jsx";
const statusColors = {
  未完成: "#94a3b8",
  进行中: "#2877d4",
  已完成: "#4f7a5a",
  已废弃: "#8a8580",
  暂搁置: "#b7791f"
};
const metricDefs = [["createdToday", "今日创建"], ["completedToday", "今日完成"], ["created7", "近 7 日创建"], ["completed7", "近 7 日完成"], ["created30", "近 30 日创建"], ["completed30", "近 30 日完成"]];
const rangeOptions = [["last7", "近 7 天"], ["lastWeek", "上周"], ["last30", "过去 30 天"], ["thisMonth", "本月"], ["lastMonth", "上月"], ["thisYear", "本年"], ["custom", "自定义时间"]];
const efficiencyLevels = [{
  min: 0,
  max: 39,
  label: "待启动",
  color: "#77736d"
}, {
  min: 40,
  max: 54,
  label: "起步",
  color: "#b7791f"
}, {
  min: 55,
  max: 69,
  label: "稳定",
  color: "#2877d4"
}, {
  min: 70,
  max: 84,
  label: "高效",
  color: "#4f7a5a"
}, {
  min: 85,
  max: 100,
  label: "巅峰",
  color: "#b54545"
}];
function comparison(metric) {
  const current = Number(metric?.current || 0);
  const previous = Number(metric?.previous || 0);
  const change = current - previous;
  const percent = previous === 0 ? current === 0 ? 0 : null : Math.round(change / previous * 100);
  return {
    current,
    previous,
    change,
    percent
  };
}
function MetricCard({
  label,
  metric
}) {
  const value = comparison(metric);
  const rising = value.change >= 0;
  const Icon = rising ? TrendingUp : TrendingDown;
  return <article className="metric-card hover-tooltip" data-tooltip={`${label} ${value.current.toLocaleString()}，上期 ${value.previous.toLocaleString()}`}>
      <span>{label}</span>
      <strong><AnimatedKpi value={value.current} /></strong>
      <small className={rising ? "rise" : "fall"}>
        <Icon size={12} />
        较上期 {value.change >= 0 ? "+" : ""}{value.change.toLocaleString()}
        {value.percent === null ? "（上期为 0）" : `（${value.percent >= 0 ? "+" : ""}${value.percent}%）`}
      </small>
    </article>;
}
function PieChart({
  rows,
  rangeLabel
}) {
  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const data = {
    labels: rows.map(item => item.status),
    datasets: [{
      data: rows.map(item => Number(item.count || 0)),
      backgroundColor: rows.map(item => statusColors[item.status] || "#77736d"),
      borderWidth: 0,
      hoverOffset: 5
    }]
  };
  return <section className="chart-panel pie-panel">
      <header><div><span>{rangeLabel}内创建的任务</span><h2>任务状态分布</h2></div><CircleDot size={18} /></header>
      <div className="pie-layout">
        <div className="pie-chart-canvas"><AnimatedChart ariaLabel="任务状态分布圆环图" data={data} height={220} type="doughnut" options={{
          cutout: "68%",
          plugins: {
            legend: {
              display: false
            }
          }
        }} /><span><strong><AnimatedKpi value={total} /></strong><small>任务</small></span></div>
        <div className="pie-legend">{rows.map(item => {
          const count = Number(item.count || 0);
          const percent = total ? Math.round(count / total * 1000) / 10 : 0;
          return <div key={item.status} tabIndex={0}><i style={{
              background: statusColors[item.status] || "#77736d"
            }} /><span>{item.status}</span><b>{count.toLocaleString()}</b><small>{percent}%</small></div>;
        })}</div>
      </div>
    </section>;
}
function chartTick(index, length) {
  if (length <= 2) return true;
  const interval = Math.max(1, Math.floor((length - 1) / 5));
  return index === 0 || index === length - 1 || index % interval === 0;
}
function DailyBars({
  rows,
  title,
  eyebrow,
  tone,
  rangeLabel
}) {
  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const color = tone === "completed" ? "#22a06b" : "#3976e8";
  const data = {
    labels: rows.map(item => item.day.slice(5).replace("-", "/")),
    datasets: [{
      label: title,
      data: rows.map(item => Number(item.count || 0)),
      backgroundColor: color,
      borderRadius: 4,
      maxBarThickness: 20
    }]
  };
  return <section className={`chart-panel bar-panel ${tone}`}>
      <header><div><span>{eyebrow} · {rangeLabel}</span><h2>{title}</h2></div><b>{total.toLocaleString()} 条</b></header>
      <AnimatedChart ariaLabel={title} data={data} height={220} type="bar" options={{
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxTicksLimit: 8,
            color: "#8290a3"
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(148,163,184,.16)"
          },
          ticks: {
            precision: 0,
            color: "#8290a3"
          }
        }
      }
    }} />
    </section>;
}
export function createHeatmapLevelScale(rows) {
  const values = rows.map(item => Number(item.total || 0)).filter(value => value > 0).sort((left, right) => left - right);
  if (!values.length) return () => 0;
  const quantile = ratio => values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))];
  const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];
  return value => {
    const count = Number(value || 0);
    if (count <= 0) return 0;
    if (count <= thresholds[0]) return 1;
    if (count <= thresholds[1]) return 2;
    if (count <= thresholds[2]) return 3;
    return 4;
  };
}
function Heatmap({
  rows,
  rangeLabel
}) {
  const firstDay = rows[0]?.day ? (new Date(`${rows[0].day}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells = [...Array.from({
    length: firstDay
  }, () => null), ...rows];
  const level = createHeatmapLevelScale(rows);
  const total = rows.reduce((sum, item) => sum + Number(item.total || 0), 0);
  return <section className="chart-panel heatmap-panel">
      <header><div><span>创建与完成各计 1 分 · {rangeLabel}</span><h2>任务活跃热力图</h2></div><span className="heat-total"><Flame size={15} />{total.toLocaleString()} 次</span></header>
      <div className="heatmap-scroll"><div className="heatmap-grid" role="img" aria-label="任务活跃热力图">{cells.map((item, index) => item ? <i className={`heat-level-${level(Number(item.total || 0))} hover-tooltip`} data-tooltip={`${item.day}：创建 ${item.created}，完成 ${item.completed}，合计 ${item.total}`} tabIndex={0} key={item.day} /> : <i className="heat-placeholder" key={`blank-${index}`} />)}</div></div>
      <footer><span>少</span>{[0, 1, 2, 3, 4].map(item => <i className={`heat-level-${item}`} key={item} />)}<span>多</span></footer>
    </section>;
}
function quantile(values, ratio) {
  const sorted = values.filter(value => value > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] : 1;
}
export function buildEfficiencySeries(rows) {
  const completionBaseline = Math.max(1, quantile(rows.map(row => Number(row.completed || 0)), 0.9));
  const activityBaseline = Math.max(1, quantile(rows.map(row => Number(row.total || 0)), 0.9));
  return rows.map((row, index) => {
    const created = Number(row.created || 0);
    const completed = Number(row.completed || 0);
    const total = created + completed;
    const recent = rows.slice(Math.max(0, index - 6), index + 1);
    const activeDays = recent.filter(item => Number(item.total || 0) > 0).length;
    const completionStrength = Math.min(completed / completionBaseline, 1) * 40;
    const balance = total ? Math.min(completed / Math.max(created, 1), 1) * 25 : 0;
    const activity = Math.min(total / activityBaseline, 1) * 20;
    const consistency = activeDays / 7 * 15;
    const score = Math.max(0, Math.min(100, Math.round(completionStrength + balance + activity + consistency)));
    const level = efficiencyLevels.find(item => score >= item.min && score <= item.max) || efficiencyLevels[0];
    return {
      ...row,
      score,
      level
    };
  });
}
function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const following = points[Math.min(points.length - 1, index + 2)];
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6
    };
    const controlTwo = {
      x: next.x - (following.x - current.x) / 6,
      y: next.y - (following.y - current.y) / 6
    };
    path += ` C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`;
  }
  return path;
}
function AreaCurve({
  rows,
  valueKey,
  minValue = 0,
  maxValue,
  tone,
  ariaLabel,
  tooltip,
  axisFormatter = value => Math.round(value)
}) {
  const floor = Number(minValue || 0);
  const ceiling = Math.max(floor + 0.1, Number(maxValue || 1));
  const color = tone === "green" ? "#22a06b" : "#3976e8";
  const data = {
    labels: rows.map(item => item.day),
    datasets: [{
      label: ariaLabel,
      data: rows.map(item => Number(item[valueKey] || 0)),
      borderColor: color,
      backgroundColor: `${color}24`,
      fill: true,
      tension: 0.36,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2
    }]
  };
  return <div className={`area-chart ${tone}`}><AnimatedChart ariaLabel={ariaLabel} data={data} height={220} type="line" options={{
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxTicksLimit: 5,
            color: "#8290a3"
          }
        },
        y: {
          min: floor,
          max: ceiling,
          grid: {
            color: "rgba(148,163,184,.16)"
          },
          ticks: {
            color: "#8290a3",
            callback: axisFormatter
          }
        }
      }
    }} /></div>;
}
function EfficiencyChart({
  rows,
  rangeLabel
}) {
  const series = buildEfficiencySeries(rows);
  const current = series.at(-1) || {
    score: 0,
    level: efficiencyLevels[0]
  };
  const average = series.length ? Math.round(series.reduce((sum, item) => sum + item.score, 0) / series.length) : 0;
  return <section className="chart-panel efficiency-panel">
      <header><div><span>纯规则算法 · {rangeLabel}</span><h2>效率得分面积曲线</h2></div><div className="efficiency-current"><Gauge size={18} /><strong>{current.score}</strong><span className="efficiency-badge" style={{
          "--level-color": current.level.color
        }}>{current.level.label}</span><small>区间均分 {average}</small></div></header>
      <AreaCurve rows={series} valueKey="score" maxValue={100} tone="blue" ariaLabel={`${rangeLabel}效率得分面积曲线`} tooltip={item => <><b>{item.day}</b><strong>{item.score} 分 · {item.level.label}</strong><span>创建 {item.created}，完成 {item.completed}</span></>} />
      <footer className="efficiency-levels">{efficiencyLevels.map(level => <span key={level.label}><i style={{
          background: level.color
        }} /><b>{level.label}</b><small>{level.min}-{level.max} 分</small></span>)}</footer>
    </section>;
}
function CompletionRateChart({
  rows,
  rangeLabel
}) {
  const current = rows.at(-1) || {
    rate: 0,
    completedTasks: 0,
    totalTasks: 0
  };
  const values = rows.map(item => Number(item.rate || 0));
  const observedMin = values.length ? Math.min(...values) : 0;
  const observedMax = values.length ? Math.max(...values) : 0;
  const observedSpan = observedMax - observedMin;
  const padding = Math.max(0.2, observedSpan * 0.18);
  let domainMin = Math.max(0, Math.floor((observedMin - padding) * 10) / 10);
  let domainMax = Math.min(100, Math.ceil((observedMax + padding) * 10) / 10);
  if (domainMax - domainMin < 1) {
    const midpoint = (observedMin + observedMax) / 2;
    domainMin = Math.max(0, Math.floor((midpoint - 0.5) * 10) / 10);
    domainMax = Math.min(100, Math.ceil((midpoint + 0.5) * 10) / 10);
  }
  return <section className="chart-panel completion-rate-panel">
      <header><div><span>累计已完成任务 ÷ 累计全部任务 · {rangeLabel}</span><h2>累计任务完成率</h2></div><div className="completion-rate-summary"><strong>{current.rate}%</strong><small>当前累计完成率</small></div></header>
      <AreaCurve rows={rows} valueKey="rate" minValue={domainMin} maxValue={domainMax} tone="green" axisFormatter={value => `${value.toFixed(1)}%`} ariaLabel={`${rangeLabel}累计任务完成率面积曲线`} tooltip={item => <><b>{item.day}</b><strong>{item.rate}%</strong><span>累计完成 {Number(item.completedTasks || 0).toLocaleString()}</span><span>累计任务 {Number(item.totalTasks || 0).toLocaleString()}</span></>} />
    </section>;
}
function ActivityRanking({
  rows,
  rangeLabel
}) {
  const max = Math.max(...rows.map(item => Number(item.total || 0)), 1);
  return <section className="chart-panel activity-ranking-panel">
      <header><div><span>创建与完成各得 1 分 · {rangeLabel}</span><h2>活跃日期 Top 10</h2></div><BarChart3 size={18} /></header>
      <div className="activity-ranking-list">{rows.map((item, index) => <article className="hover-tooltip" data-tooltip={`${item.day}：创建 ${item.created}，完成 ${item.completed}，总计 ${item.total} 分`} tabIndex={0} key={item.day}><b>{index + 1}</b><time>{item.day}</time><div><i style={{
            width: `${Math.max(Number(item.total || 0) / max * 100, 2)}%`
          }} /></div><span>创建 {item.created}</span><span>完成 {item.completed}</span><strong>{item.total} 分</strong></article>)}</div>
    </section>;
}
function localDay(offset = 0) {
  const value = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}
export function StatsPage({
  lists
}) {
  const [listId, setListId] = useState(null);
  const [selectedRange, setSelectedRange] = useState({
    preset: "last30"
  });
  const [rangeChoice, setRangeChoice] = useState("last30");
  const [customRange, setCustomRange] = useState({
    from: localDay(-29),
    to: localDay()
  });
  const [rangeError, setRangeError] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      range: selectedRange.preset
    });
    if (listId) params.set("listId", listId);
    if (selectedRange.preset === "custom") {
      params.set("from", selectedRange.from);
      params.set("to", selectedRange.to);
    }
    setLoading(true);
    setError("");
    api(`/api/stats?${params}`, {
      signal: controller.signal
    }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(reason => {
      if (!controller.signal.aborted && reason.name !== "AbortError") setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [listId, selectedRange]);
  const activeList = useMemo(() => lists.find(list => list.id === listId), [listId, lists]);
  const applyRangeChoice = value => {
    setRangeChoice(value);
    setRangeError("");
    if (value !== "custom") setSelectedRange({
      preset: value
    });
  };
  const applyCustomRange = () => {
    if (!customRange.from || !customRange.to || customRange.from > customRange.to) {
      setRangeError("请选择正确的开始和结束日期");
      return;
    }
    setRangeError("");
    setSelectedRange({
      preset: "custom",
      ...customRange
    });
  };
  if (!data && loading) return <div className="table-state"><LoaderCircle className="spin" size={20} />正在汇总统计图表</div>;
  if (!data && error) return <div className="table-state empty">统计读取失败：{error}</div>;
  const rangeLabel = `${data.range?.label || "统计区间"} · ${data.range?.start || ""} 至 ${data.range?.end || ""}`;
  return <section className={`analytics-page ${loading ? "is-loading" : ""}`}>
      <div className="stats-slicer" aria-label="统计清单切片器"><span>统计范围</span><OkrButton className={!listId ? "active" : ""} onClick={() => setListId(null)}>全部清单</OkrButton>{lists.map(list => <OkrButton className={listId === list.id ? "active" : ""} key={list.id} onClick={() => setListId(list.id)}><i style={{
          background: list.color
        }} />{list.name}</OkrButton>)}<em>{activeList ? `当前：${activeList.name}` : "当前：全部清单"}</em></div>
      <div className="stats-range-toolbar">
        <div><CalendarRange size={15} /><label htmlFor="stats-range">图表时间</label><OkrSelect id="stats-range" value={rangeChoice} onChange={event => applyRangeChoice(event.target.value)}>{rangeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></div>
        {rangeChoice === "custom" && <div className="stats-custom-range"><OkrInput aria-label="统计开始日期" type="date" value={customRange.from} onChange={event => setCustomRange(current => ({
          ...current,
          from: event.target.value
        }))} /><span>至</span><OkrInput aria-label="统计结束日期" type="date" value={customRange.to} onChange={event => setCustomRange(current => ({
          ...current,
          to: event.target.value
        }))} /><OkrButton onClick={applyCustomRange}>应用</OkrButton></div>}
        <p>{rangeError || rangeLabel}</p>
        <aside><span>创建 <b>{Number(data.rangeSummary?.created?.current || 0).toLocaleString()}</b></span><span>完成 <b>{Number(data.rangeSummary?.completed?.current || 0).toLocaleString()}</b></span><span>活跃 <b>{Number(data.rangeSummary?.activity || 0).toLocaleString()}</b></span></aside>
      </div>
      <div className="metric-grid">{metricDefs.map(([key, label]) => <MetricCard key={key} label={label} metric={data.metrics?.[key]} />)}</div>
      <EfficiencyChart rows={data.dailyActivity || []} rangeLabel={data.range?.label || "统计区间"} />
      <CompletionRateChart rows={data.dailyCompletionRate || []} rangeLabel={data.range?.label || "统计区间"} />
      <div className="analytics-grid"><PieChart rows={data.byStatus || []} rangeLabel={data.range?.label || "统计区间"} /><DailyBars rows={data.dailyCompleted || []} title="每日完成任务" eyebrow="完成趋势" tone="completed" rangeLabel={data.range?.label || "统计区间"} /><DailyBars rows={data.dailyCreated || []} title="每日创建任务" eyebrow="创建趋势" tone="created" rangeLabel={data.range?.label || "统计区间"} /></div>
      <Heatmap rows={data.heatmap || []} rangeLabel={data.range?.label || "统计区间"} />
      <ActivityRanking rows={data.activeRanking || []} rangeLabel={data.range?.label || "统计区间"} />
      {Number(data.summary?.undatedCompleted || 0) > 0 && <p className="stats-data-note">{Number(data.summary.undatedCompleted).toLocaleString()} 条历史已完成任务没有可追溯的完成日期，未计入按日图表与日期排名。</p>}
    </section>;
}
