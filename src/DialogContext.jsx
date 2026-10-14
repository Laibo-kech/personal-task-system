import React, { createContext, useContext, useRef, useState } from "react";
import { Modal, OkrButton, OkrInput, OkrTextarea } from "./okr-ui.jsx";
const DialogContext = createContext(null);
export function DialogProvider({
  children
}) {
  const resolver = useRef(null);
  const [dialog, setDialog] = useState(null);
  const [value, setValue] = useState("");
  const open = next => new Promise(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setValue(next.initialValue || "");
    setDialog(next);
  });
  const close = result => {
    const resolve = resolver.current;
    resolver.current = null;
    setDialog(null);
    resolve?.(result);
  };
  const api = {
    askText: options => open({
      type: "text",
      confirmLabel: "确认",
      ...options
    }),
    confirm: options => open({
      type: "confirm",
      confirmLabel: "确认",
      ...options
    })
  };
  const cancel = () => close(dialog?.type === "text" ? "" : false);
  return <DialogContext.Provider value={api}>
    {children}
    {dialog && <Modal open title={dialog.title} description={dialog.message} onOpenChange={open => !open && cancel()} footer={<>
        <OkrButton type="button" variant="secondary" onClick={cancel}>取消</OkrButton>
        <OkrButton type="button" variant={dialog.danger ? "danger" : "primary"} disabled={dialog.type === "text" && !value.trim()} onClick={() => close(dialog.type === "text" ? value : true)}>{dialog.confirmLabel}</OkrButton>
      </>}>
      {dialog.type === "text" && <label className="okr-dialog-field">
        {dialog.label && <span>{dialog.label}</span>}
        {dialog.multiline ? <OkrTextarea autoFocus value={value} rows={5} placeholder={dialog.placeholder || ""} onChange={event => setValue(event.target.value)} /> : <OkrInput autoFocus value={value} placeholder={dialog.placeholder || ""} onChange={event => setValue(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && value.trim()) {
            event.preventDefault();
            close(value);
          }
        }} />}
      </label>}
    </Modal>}
  </DialogContext.Provider>;
}
export function useAppDialog() {
  const value = useContext(DialogContext);
  if (!value) throw new Error("useAppDialog must be used inside DialogProvider");
  return value;
}
