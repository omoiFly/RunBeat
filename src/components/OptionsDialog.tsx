import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useI18n, type AppLanguage } from "../i18n";

export function OptionsDialog({ onClose }: { onClose: () => void }) {
  const { language, setLanguage, t } = useI18n();
  const [draftLanguage, setDraftLanguage] = useState<AppLanguage>(language);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-input-shield" />
      <Dialog.Content className="property-dialog options-dialog window">
        <div className="title-bar">
          <Dialog.Title className="title-bar-text">{t("选项")}</Dialog.Title>
          <div className="title-bar-controls"><Dialog.Close asChild><button type="button" className="close" aria-label={t("关闭")} /></Dialog.Close></div>
        </div>
        <div className="options-dialog-body">
          <Dialog.Description>{t("这些选项适用于此浏览器中的所有项目。")}</Dialog.Description>
          <fieldset>
            <legend>{t("界面语言")}</legend>
            <label htmlFor="options-language">{t("语言")}</label>
            <select id="options-language" value={draftLanguage} onChange={(event) => setDraftLanguage(event.target.value as AppLanguage)}>
              <option value="zh-CN">中文</option><option value="en">English</option>
            </select>
          </fieldset>
        </div>
        <div className="dialog-command-row">
          <button className="default" type="button" onClick={() => { setLanguage(draftLanguage); onClose(); }}>{t("确定")}</button>
          <button type="button" onClick={onClose}>{t("取消")}</button>
          <button type="button" disabled={draftLanguage === language} onClick={() => setLanguage(draftLanguage)}>{t("应用")}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
