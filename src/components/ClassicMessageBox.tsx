import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { ClassicIcon, type ClassicIconName } from "./ClassicIcon";

export interface MessageBoxButton<T extends string> {
  value: T;
  label: string;
  accessKey?: string;
  default?: boolean;
}

export function ClassicMessageBox<T extends string>({
  open,
  title,
  message,
  icon = "info",
  buttons,
  cancelValue,
  onSelect
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  icon?: Extract<ClassicIconName, "warning" | "info" | "error">;
  buttons: MessageBoxButton<T>[];
  cancelValue?: T;
  onSelect: (value: T) => void;
}) {
  const { t } = useI18n();
  const defaultRef = useRef<HTMLButtonElement>(null);
  const defaultButton = useMemo(() => buttons.find((button) => button.default) ?? buttons[0], [buttons]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && cancelValue) onSelect(cancelValue);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-input-shield" />
        <Dialog.Content
          className="message-box window"
          onEscapeKeyDown={(event) => {
            if (!cancelValue) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => defaultRef.current?.focus());
          }}
        >
          <div className="title-bar">
            <Dialog.Title className="title-bar-text">{title}</Dialog.Title>
            {cancelValue && <div className="title-bar-controls">
              <Dialog.Close asChild>
                <button className="close" type="button" aria-label={t("关闭")} />
              </Dialog.Close>
            </div>}
          </div>
          <div className="message-box-body">
            <ClassicIcon name={icon} size={32} />
            <Dialog.Description asChild><div className="message-box-copy">{message}</div></Dialog.Description>
          </div>
          <div className="message-box-actions">
            {buttons.map((button) => (
              <button
                key={button.value}
                ref={button.value === defaultButton?.value ? defaultRef : undefined}
                className={button.default ? "default" : undefined}
                type="button"
                accessKey={button.accessKey}
                onClick={() => onSelect(button.value)}
              >
                {button.label}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
