"use client";
import {useEffect,useRef,useState,useId} from 'react';
import type ApexCharts from 'apexcharts';
import type {ApexOptions} from 'apexcharts';
export type ChartPoint={date:string;value:number|null};
export type ChartSeries={name:string;points:ChartPoint[]};
export type ChartProps={series:ChartSeries[];type?:'line'|'area'|'bar';height?:number;unit?:string;theme?:'light'|'dark';reference?:{value:number;label:string};onPointClick?:(p:{seriesName:string;date:string;value:number|null})=>void};
const FONT="Geist, 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
export function Chart({series,type='line',height=280,unit='',theme='light',reference,onPointClick}:ChartProps){
 const host=useRef<HTMLDivElement>(null),instance=useRef<ApexCharts|null>(null),callback=useRef(onPointClick),[error,setError]=useState('');const id=useId().replace(/:/g,'');callback.current=onPointClick;
 const latest=useRef(series);latest.current=series;
 const signature=JSON.stringify({series,type,height,unit,theme,reference});
 useEffect(()=>{let disposed=false;let owned:ApexCharts|null=null;setError('');
 const render=async()=>{try{const {default:Apex}=await import('apexcharts');if(disposed||!host.current)return;
 const dates=Array.from(new Set(series.flatMap(s=>s.points.map(p=>p.date)))).sort();
 const options:ApexOptions={chart:{id,type,height,fontFamily:FONT,toolbar:{show:false},animations:{enabled:false},parentHeightOffset:0,foreColor:theme==='dark'?'#98a2b3':'#667085',events:{dataPointSelection:(_e,_ctx,cfg)=>{const s=latest.current[cfg.seriesIndex];const date=dates[cfg.dataPointIndex];if(s&&date)callback.current?.({seriesName:s.name,date,value:s.points.find(p=>p.date===date)?.value??null});}}},colors:['#465fff','#12b76a','#f79009'],series:series.map(s=>({name:s.name,data:dates.map(date=>s.points.find(p=>p.date===date)?.value??null)})),xaxis:{categories:dates,axisBorder:{show:false},axisTicks:{show:false},tickAmount:5,labels:{rotate:0,hideOverlappingLabels:true,formatter:v=>String(v).slice(5)}},yaxis:{labels:{formatter:v=>Number.isFinite(v)?`${Math.round(v*10)/10}${unit}`:''}},grid:{borderColor:theme==='dark'?'#344054':'#f2f4f7',strokeDashArray:3},stroke:{curve:'straight',width:type==='bar'?0:2.5},markers:{size:type==='bar'?0:4,hover:{size:6}},fill:{type:'solid',opacity:type==='area'?.14:1},plotOptions:{bar:{borderRadius:4,columnWidth:'45%'}},dataLabels:{enabled:false},legend:{position:'top',horizontalAlign:'left',fontFamily:FONT,fontSize:'12px'},tooltip:{theme,shared:false,intersect:true,y:{formatter:v=>v==null?'暂无数据':`${v}${unit}`}},annotations:reference?{yaxis:[{y:reference.value,borderColor:'#98a2b3',strokeDashArray:4,label:{text:reference.label,style:{fontFamily:FONT,background:theme==='dark'?'#344054':'#f2f4f7',color:theme==='dark'?'#f2f4f7':'#667085'}}}]}:undefined};
 owned=new Apex(host.current,options);instance.current=owned;await owned.render();if(disposed)owned.destroy();
 }catch(e){if(!disposed)setError(e instanceof Error?e.message:'图表加载失败');}};void render();
 return()=>{disposed=true;if(owned){owned.destroy();if(instance.current===owned)instance.current=null;}};
 },[signature,id]);
 return <div className="wx-chart" style={{height}}>{error&&<div role="alert">{error}</div>}<div ref={host} hidden={!!error} role="img" aria-label={`${series.map(s=>s.name).join('、')}${type==='bar'?'柱状':'趋势'}图`}/></div>;
}
export function LineChart(props:Omit<ChartProps,'type'>){return <Chart {...props} type="line"/>;}
export function AreaChart(props:Omit<ChartProps,'type'>){return <Chart {...props} type="area"/>;}
export function BarChart(props:Omit<ChartProps,'type'>){return <Chart {...props} type="bar"/>;}
export function DonutChart({values,labels,height=250,theme='light',onSliceClick}:{values:number[];labels:string[];height?:number;theme?:'light'|'dark';onSliceClick?:(index:number)=>void}){
 const host=useRef<HTMLDivElement>(null),cb=useRef(onSliceClick),[error,setError]=useState('');cb.current=onSliceClick;
 useEffect(()=>{let gone=false,chart:ApexCharts|undefined;import('apexcharts').then(async({default:Apex})=>{if(gone||!host.current)return;chart=new Apex(host.current,{chart:{type:'donut',height,fontFamily:FONT,animations:{enabled:false},events:{dataPointSelection:(_e:unknown,_c:unknown,config:{dataPointIndex:number})=>cb.current?.(config.dataPointIndex)}},series:values,labels,colors:['#465fff','#12b76a','#f79009','#98a2b3'],stroke:{width:3,colors:[theme==='dark'?'#1a2231':'#fff']},dataLabels:{enabled:false},legend:{position:'bottom',labels:{colors:theme==='dark'?'#98a2b3':'#667085'}},tooltip:{theme},plotOptions:{pie:{donut:{size:'76%'}}}});await chart.render();}).catch(e=>{if(!gone)setError(String(e));});return()=>{gone=true;chart?.destroy();};},[JSON.stringify({values,labels,height,theme})]);
 return <div className="wx-chart" style={{height}}>{error&&<p role="alert">{error}</p>}<div ref={host} hidden={!!error} role="img" aria-label="分类占比环形图"/></div>;
}
export function ProgressGauge({value,label='完成进度',height=240,theme='light'}:{value:number;label?:string;height?:number;theme?:'light'|'dark'}){
 const host=useRef<HTMLDivElement>(null),[error,setError]=useState('');
 useEffect(()=>{
  let gone=false,chart:ApexCharts|undefined;setError('');
  import('apexcharts').then(async({default:Apex})=>{
   if(gone||!host.current)return;
   chart=new Apex(host.current,{chart:{type:'radialBar',height,fontFamily:FONT,animations:{enabled:false}},series:[Math.max(0,Math.min(100,value))],labels:[label],colors:['#465fff'],plotOptions:{radialBar:{startAngle:-90,endAngle:90,hollow:{size:'78%'},track:{background:theme==='dark'?'#344054':'#e4e7ec',strokeWidth:'100%'},dataLabels:{name:{offsetY:22,color:theme==='dark'?'#98a2b3':'#667085',fontWeight:400,fontSize:'13px'},value:{offsetY:-18,color:theme==='dark'?'#f2f4f7':'#1d2939',fontSize:'30px',fontWeight:600}}}},stroke:{lineCap:'round'}});
   await chart.render();
  }).catch(e=>{if(!gone)setError(e instanceof Error?e.message:'图表加载失败');});
  return()=>{gone=true;chart?.destroy();};
 },[value,label,height,theme]);
 return <div className="wx-chart" style={{height}}>{error&&<p role="alert">{error}</p>}<div ref={host} hidden={!!error} role="img" aria-label={`${label} ${Math.min(100,Math.max(0,value))}%`}/></div>;
}
