import { useState } from "react";
import { Overlay } from "../overlay/Overlay";
import { ProjectVideoSettings } from "./ProjectVideoSettings";
import { confirmAction } from "../../lib/tauri-api";
import type { useProjectSettings } from "../../hooks/useProjectSettings";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function ProjectSettingsDialog({
  folder,
  model,
  pendingCount,
  onBatch,
  onClose,
}: {
  folder: string;
  model: ReturnType<typeof useProjectSettings>;
  pendingCount: number;
  onBatch?: () => void;
  onClose: () => void;
}) {
  const [hasUnsaved, setHasUnsaved] = useState(false);

  async function requestClose() {
    if (
      hasUnsaved &&
      !(await confirmAction("项目设置有未保存的修改，关闭将丢弃这些修改。确定关闭？"))
    ) {
      return;
    }
    setHasUnsaved(false);
    onClose();
  }

  return (
    <Overlay onClose={requestClose} canDismiss={!model.saving} label={text.projectSettings}>
      <section
        tabIndex={-1}
        aria-label={text.projectSettings}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{text.projectSettings}</h2>
          <button
            type="button"
            disabled={model.saving}
            onClick={requestClose}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
          >
            {text.close}
          </button>
        </header>
        <p className="mt-2 break-all text-xs text-slate-400">{folder}</p>
        <ProjectVideoSettings folder={folder} model={model} onUnsavedChange={setHasUnsaved} />
        <section className="mt-4 rounded border border-slate-800 p-3">
          <p className="text-sm text-slate-200">{text.pendingVideos(pendingCount)}</p>
          <p className="mt-2 text-xs text-slate-400">{text.batchSettingsHint}</p>
          <button
            type="button"
            disabled={!onBatch || model.saving || model.loading || !!model.error}
            onClick={onBatch}
            className="mt-3 rounded bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {text.batchPrepare}
          </button>
        </section>
      </section>
    </Overlay>
  );
}
