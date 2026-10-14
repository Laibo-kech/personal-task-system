"use client";
import {useEffect,useId,useState,type ReactNode} from 'react';
import {Dialog,DropdownMenu,Toast} from 'radix-ui';
import {X,MoreHorizontal} from 'lucide-react';
import {Button,IconButton,useUITheme} from './primitives';

export function Modal({open,onOpenChange,title,description,children,footer,drawer=false}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description?:string;children:ReactNode;footer?:ReactNode;drawer?:boolean}) {
  const theme=useUITheme(),descriptionId=useId();return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="wx-overlay"/><Dialog.Content aria-describedby={description ? descriptionId : undefined} className={`wx-ui wx-dialog ${drawer?'wx-drawer':''}`} data-wx-theme={theme}><div className="wx-between"><Dialog.Title className="wx-dialog-title">{title}</Dialog.Title><Dialog.Close asChild><IconButton label="关闭" variant="ghost"><X size={18}/></IconButton></Dialog.Close></div>{description && <Dialog.Description id={descriptionId} className="wx-muted">{description}</Dialog.Description>}<div className="wx-dialog-body">{children}</div>{footer && <footer className="wx-dialog-footer">{footer}</footer>}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Drawer(props:Omit<Parameters<typeof Modal>[0],'drawer'>){return <Modal {...props} drawer/>;}
export const RecordDrilldown=Drawer;
export function ConfirmDialog({open,onOpenChange,title,message,onConfirm}:{open:boolean;onOpenChange:(v:boolean)=>void;title:string;message:string;onConfirm:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(open)setError('');},[open]);
  const confirm=async()=>{if(busy)return;setBusy(true);setError('');try{await onConfirm();onOpenChange(false);}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}};
  return <Modal open={open} onOpenChange={v=>!busy&&onOpenChange(v)} title={title} description={message} footer={<><Button variant="secondary" disabled={busy} onClick={()=>onOpenChange(false)}>取消</Button><Button variant="danger" loading={busy} onClick={confirm}>确认</Button></>}>{error && <p role="alert" className="wx-error-text">{error}</p>}</Modal>;
}
export function ActionMenu({items,label='更多操作',trigger}:{items:{label:string;onSelect:()=>void;disabled?:boolean;danger?:boolean}[];label?:string;trigger?:ReactNode}) {
  const theme=useUITheme();return <DropdownMenu.Root><DropdownMenu.Trigger asChild>{trigger || <IconButton label={label} variant="ghost"><MoreHorizontal size={18}/></IconButton>}</DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content sideOffset={6} align="end" className="wx-ui wx-menu" data-wx-theme={theme}>{items.map((item,i)=><DropdownMenu.Item key={i} onSelect={item.onSelect} disabled={item.disabled} className={`wx-menu-item ${item.danger?'wx-error-text':''}`}>{item.label}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}
export function ToastMessage({open,onOpenChange,message}:{open:boolean;onOpenChange:(v:boolean)=>void;message:string}) {
  return <Toast.Provider duration={3500}><Toast.Root open={open} onOpenChange={onOpenChange} className="wx-toast"><Toast.Description>{message}</Toast.Description><Toast.Close asChild><IconButton label="关闭消息" variant="ghost"><X size={16}/></IconButton></Toast.Close></Toast.Root><Toast.Viewport className="wx-toast-viewport"/></Toast.Provider>;
}
