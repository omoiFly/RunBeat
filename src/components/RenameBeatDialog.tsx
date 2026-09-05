import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { renameLibraryBeat } from "../services/beatLibrary";
import { MAX_BEAT_NAME_LENGTH } from "../services/beatNames";

export function RenameBeatDialog({ resourceId, name, fileName, onRenamed, onClose }: {
  resourceId: string;
  name: string;
  fileName: string;
  onRenamed: (name: string) => void;
  onClose: () => void;
}) {
  const { t, translateMessage } = useI18n();
  const [draftName, setDraftName] = useState(name);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError(undefined);
    try { onRenamed(await renameLibraryBeat(resourceId, draftName)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(false); }
  };

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !working) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-input-shield" />
      <Dialog.Content className="property-dialog rename-beat-dialog window"
        onEscapeKeyDown={(event) => { if (working) event.preventDefault(); }}
        onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); input.current?.select(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById(`library-beat-${resourceId}`)?.focus(); }}>
        <div className="title-bar">
          <Dialog.Title className="title-bar-text">{t("重命名鼓点")}</Dialog.Title>
          <div className="title-bar-controls"><Dialog.Close asChild><button type="button" className="close" aria-label={t("关闭")} disabled={working} /></Dialog.Close></div>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <div className="rename-beat-body">
            <Dialog.Description>{t("原文件：{name}", { name: fileName })}</Dialog.Description>
            <label htmlFor="rename-beat-name">{t("鼓点名称:")}</label>
            <input ref={input} id="rename-beat-name" value={draftName} maxLength={MAX_BEAT_NAME_LENGTH} disabled={working} onChange={(event) => { setDraftName(event.target.value); setError(undefined); }} />
            {error && <p role="alert" className="beat-library-error">{translateMessage(error)}</p>}
          </div>
          <div className="dialog-command-row">
            <button type="submit" className="default" disabled={working || !draftName.trim()}>{t("确定")}</button>
            <button type="button" onClick={onClose} disabled={working}>{t("取消")}</button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
