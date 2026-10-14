"use client";
import { createContext, useContext, useId, type ReactNode, type ComponentProps, type CSSProperties } from 'react';
import { Checkbox as RCheckbox, Switch as RSwitch, Tooltip as RTooltip } from 'radix-ui';
import { Check, LoaderCircle, RefreshCw } from 'lucide-react';

export type Tone = 'brand' | 'success' | 'warning' | 'error' | 'neutral';
export type Theme = 'light' | 'dark';
export const ThemeContext = createContext<Theme>('light');
export function UIProvider({ theme = 'light', children, className = '' }: {theme?: Theme; children: ReactNode; className?: string}) {
  return <ThemeContext value={theme}><RTooltip.Provider delayDuration={300}><div className={`wx-ui ${className}`} data-wx-theme={theme}>{children}</div></RTooltip.Provider></ThemeContext>;
}
export function useUITheme() { return useContext(ThemeContext); }
export function Button({ variant = 'primary', size = 'md', loading, children, className = '', disabled, ...props }: ComponentProps<'button'> & {variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean}) {
  return <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={`wx-button wx-button-${variant} wx-${size} ${className}`}>{loading && <LoaderCircle className="wx-spin" size={16}/>} {children}</button>;
}
export function IconButton({ label, children, ...props }: Omit<ComponentProps<typeof Button>, 'children'> & {label: string; children: ReactNode}) {
  return <Tooltip content={label}><Button {...props} aria-label={label} className={`wx-icon-button ${props.className || ''}`}>{children}</Button></Tooltip>;
}
export function Input({ invalid, className = '', ...props }: ComponentProps<'input'> & {invalid?: boolean}) {
  return <input {...props} aria-invalid={invalid || undefined} className={`wx-input ${className}`}/>;
}
export function NumberInput(props: ComponentProps<typeof Input>) { return <Input {...props} type="number" inputMode="decimal"/>; }
export function Textarea(props: ComponentProps<'textarea'>) { return <textarea {...props} className={`wx-input wx-textarea ${props.className || ''}`}/>; }
export function FormField({ label, error, hint, children, required }: {label: string; error?: string; hint?: string; children: (props: {id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean})=>ReactNode; required?: boolean}) {
  const id = useId();
  return <div className="wx-field"><label htmlFor={id}>{label}{required && <span className="wx-error-text"> *</span>}</label>{children({id, 'aria-describedby': error || hint ? `${id}-help` : undefined, 'aria-invalid': !!error})}{(error || hint) && <small id={`${id}-help`} className={error ? 'wx-error-text' : 'wx-muted'}>{error || hint}</small>}</div>;
}
export function Checkbox({ label, checked, onCheckedChange, disabled }: {label: string; checked: boolean; onCheckedChange: (v:boolean)=>void; disabled?: boolean}) {
  const id=useId(); return <div className="wx-check-label"><RCheckbox.Root id={id} checked={checked} onCheckedChange={v=>onCheckedChange(v===true)} disabled={disabled} className="wx-checkbox"><RCheckbox.Indicator><Check size={14}/></RCheckbox.Indicator></RCheckbox.Root><label htmlFor={id}>{label}</label></div>;
}
export function Switch({label, checked, onCheckedChange, disabled}: {label: string; checked:boolean; onCheckedChange:(v:boolean)=>void; disabled?:boolean}) {
  const id=useId(); return <div className="wx-check-label"><RSwitch.Root id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="wx-switch"><RSwitch.Thumb className="wx-switch-thumb"/></RSwitch.Root><label htmlFor={id}>{label}</label></div>;
}
export function SegmentedControl<T extends string>({value, options, onChange, label='选择视图'}:{value:T; options:{value:T;label:string}[];onChange:(v:T)=>void;label?:string}) {
  return <div className="wx-segment" role="group" aria-label={label}>{options.map(o=><button key={o.value} type="button" aria-pressed={value===o.value} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>;
}
export const QuickPeriodFilter = SegmentedControl;
export function Tooltip({content, children}:{content:string;children:ReactNode}) {
  const theme=useUITheme(); return <RTooltip.Root><RTooltip.Trigger asChild>{children}</RTooltip.Trigger><RTooltip.Portal><RTooltip.Content sideOffset={6} className="wx-ui wx-tooltip" data-wx-theme={theme}>{content}<RTooltip.Arrow className="wx-tooltip-arrow"/></RTooltip.Content></RTooltip.Portal></RTooltip.Root>;
}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:Tone}){return <span className={`wx-badge wx-tone-${tone}`}>{children}</span>;}
export const StatusBadge=Badge;
export function ProgressBar({value,label}:{value:number;label:string}){const v=Math.min(100,Math.max(0,Number.isFinite(value)?value:0));return <div className="wx-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}><span style={{width:`${v}%`}}/></div>;}
export function ProgressCompare({progress,timeProgress,compact=false}:{progress:number;timeProgress:number;compact?:boolean}) {
  const cap=(v:number)=>Math.max(0,Math.min(100,Number.isFinite(v)?v:0));
  return <div className="wx-progress-compare">{!compact && <div className="wx-between"><span>{cap(progress).toFixed(1)}%</span><small className="wx-muted">时间 {cap(timeProgress).toFixed(1)}%</small></div>}<div className="wx-progress-line"><ProgressBar value={progress} label="完成进度"/><span className="wx-time-marker" style={{left:`${cap(timeProgress)}%`}} aria-label={`时间进度 ${cap(timeProgress)}%`}/></div></div>;
}
export function Card({children,className='',style}:{children:ReactNode;className?:string;style?:CSSProperties}) {return <section className={`wx-card ${className}`} style={style}>{children}</section>;}
export function MetricCard({label,value,note,icon,tone='brand',delta}:{label:string;value:ReactNode;note?:string;icon?:ReactNode;tone?:Tone;delta?:string}) {
  return <Card className="wx-metric"><div className="wx-between"><span className={`wx-metric-icon wx-tone-${tone}`}>{icon}</span>{delta && <Badge>{delta}</Badge>}</div><p className="wx-muted">{label}</p><div className="wx-between wx-baseline"><strong>{value}</strong><small className="wx-muted">{note}</small></div></Card>;
}
export function PageHeader({eyebrow,title,actions}:{eyebrow?:string;title:string;actions?:ReactNode}) {return <header className="wx-page-header"><div>{eyebrow && <p className="wx-eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>{actions && <div className="wx-actions">{actions}</div>}</header>;}
export function SectionTitle({title,action}:{title:string;action?:ReactNode}) {return <div className="wx-section-title"><h2>{title}</h2>{action}</div>;}
export function LoadingState({label='正在加载'}:{label?:string}) {return <div className="wx-state" role="status"><LoaderCircle size={24} className="wx-spin"/><span>{label}</span></div>;}
export function EmptyState({title='暂无数据',action}:{title?:string;action?:ReactNode}) {return <div className="wx-state"><span className="wx-empty-symbol">—</span><p>{title}</p>{action}</div>;}
export function ErrorState({message,onRetry}:{message:string;onRetry?:()=>void}) {return <div className="wx-state" role="alert"><p className="wx-error-text">{message}</p>{onRetry && <Button variant="secondary" onClick={onRetry}><RefreshCw size={16}/>重试</Button>}</div>;}
