import React, { Children, isValidElement, useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { Badge, Button, Input, Select as KitSelect, Textarea, UIProvider, ToastMessage } from "./ui/index.ts";
export { ActionMenu, Badge, Checkbox, Modal, Pagination, Select, useUITheme } from "./ui/index.ts";
export function OkrProvider({
  children
}) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    const notify = event => setNotice(event.detail);
    window.addEventListener("okr-preview-notice", notify);
    return () => {
      observer.disconnect();
      window.removeEventListener("okr-preview-notice", notify);
    };
  }, []);
  return <UIProvider theme={theme} className="okr-preview">
    {children}
    <ToastMessage open={Boolean(notice)} onOpenChange={open => !open && setNotice("")} message={notice} />
  </UIProvider>;
}
export function OkrButton({
  className = "",
  variant,
  type = "submit",
  external = false,
  title,
  ...props
}) {
  const classes = className.split(/\s+/);
  const tone = variant || (classes.some(name => ["primary", "primary-button"].includes(name)) ? "primary" : classes.includes("danger-button") ? "danger" : "ghost");
  return <Button {...props} type={type} variant={tone} className={`okr-button ${className}`} title={title} aria-label={props["aria-label"] || title} disabled={props.disabled} />;
}
export function OkrInput(props) {
  if (["checkbox", "radio"].includes(props.type)) return <input {...props} className={`okr-native-choice ${props.className || ""}`} />;
  if (["color", "range", "file", "hidden"].includes(props.type)) return <input {...props} />;
  return <Input {...props} />;
}
export function OkrTextarea(props) {
  return <Textarea {...props} />;
}
export function OkrDialogSurface({
  children,
  title,
  className = "",
  onClose,
  asChild = false
}) {
  const previousFocus = useRef(document.activeElement);
  const content = asChild ? React.cloneElement(children, {
    className: `wx-ui okr-dialog-surface ${children.props.className || ""}`
  }, <Dialog.Title className="okr-sr-only">{title}</Dialog.Title>, children.props.children) : <>
    <Dialog.Title className="okr-sr-only">{title}</Dialog.Title>{children}
  </>;
  return <Dialog.Root open onOpenChange={open => !open && onClose()}>
    <Dialog.Portal>
      <div className="okr-preview okr-dialog-portal">
        <Dialog.Overlay className="okr-dialog-overlay" />
        <Dialog.Content asChild={asChild} className={asChild ? undefined : `wx-ui okr-dialog-surface ${className}`} aria-describedby={undefined} onCloseAutoFocus={event => {
          event.preventDefault();
          const target = previousFocus.current?.isConnected ? previousFocus.current : document.querySelector('[aria-label="视图设置"]');
          target?.focus?.();
        }}>
          {content}
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  </Dialog.Root>;
}
export function OkrCellPopover({
  children,
  onClose,
  label
}) {
  return <Popover.Root open onOpenChange={open => !open && onClose()}>
    <Popover.Anchor asChild><span className="okr-cell-anchor" aria-hidden="true" /></Popover.Anchor>
    <Popover.Portal>
      <div className="okr-preview okr-cell-portal">
        <Popover.Content className="wx-ui okr-cell-popover" aria-label={label} side="bottom" align="start" sideOffset={4} collisionPadding={12} hideWhenDetached onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onCloseAutoFocus={event => event.preventDefault()}>
          {children}
        </Popover.Content>
      </div>
    </Popover.Portal>
  </Popover.Root>;
}
export function OkrToolbarMenu({
  children,
  trigger,
  label
}) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal><div className="okr-preview okr-cell-portal">
      <Popover.Content className="wx-ui okr-toolbar-menu" aria-label={label} align="end" sideOffset={6} collisionPadding={12} onCloseAutoFocus={event => event.preventDefault()} onClick={event => {
          if (event.target.closest("button")) setOpen(false);
        }}>
        {children}
      </Popover.Content>
    </div></Popover.Portal>
  </Popover.Root>;
}
function optionText(value) {
  return Children.toArray(value).map(child => isValidElement(child) ? optionText(child.props.children) : String(child)).join("");
}
function selectOptions(children, inheritedDisabled = false) {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement(child)) return [];
    if (child.type === "option") {
      const label = optionText(child.props.children);
      return [{
        value: String(child.props.value ?? label),
        label,
        disabled: inheritedDisabled || child.props.disabled
      }];
    }
    return selectOptions(child.props.children, inheritedDisabled || child.props.disabled);
  });
}
export function OkrSelect({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  id,
  name,
  className = "",
  "aria-label": label
}) {
  const emptyValue = `okr-empty-${useId()}`;
  const host = useRef(null);
  const options = selectOptions(children);
  const [localValue, setLocalValue] = useState(() => String(defaultValue ?? options[0]?.value ?? ""));
  const selected = value === undefined ? localValue : String(value ?? "");
  const change = encoded => {
    let next = encoded === emptyValue ? "" : encoded;
    host.current?.removeAttribute("data-invalid");
    setLocalValue(next);
    const target = {
      name
    };
    Object.defineProperty(target, "value", {
      get: () => next,
      set: updated => {
        next = String(updated);
        setLocalValue(next);
      },
      enumerable: true
    });
    onChange?.({
      target,
      currentTarget: target,
      type: "change",
      preventDefault() {},
      stopPropagation() {}
    });
  };
  return <span className={`okr-select-field ${className}`} ref={host}>
    <KitSelect id={id} label={label || options[0]?.label || "选择选项"} value={selected === "" ? emptyValue : selected} onChange={change} disabled={disabled} options={options.map(option => ({
      ...option,
      value: option.value === "" ? emptyValue : option.value
    }))} />
    {name && <input type="hidden" name={name} value={selected} disabled={disabled} />}
    {required && <input className="okr-select-validity" tabIndex={-1} aria-hidden="true" required disabled={disabled} value={selected} onChange={() => {}} onInvalid={event => {
      event.preventDefault();
      host.current?.querySelector('[role="combobox"]')?.focus();
      host.current?.setAttribute("data-invalid", "true");
    }} />}
  </span>;
}
export function OkrBadge({
  children,
  tone = "neutral"
}) {
  return <Badge tone={tone}>{children}</Badge>;
}
