import { useEffect, useState } from "react";
import { useOperations } from "../store/useOperations";
import { OPERATION_ZH_CN as text } from "../i18n/operations.zh-CN";

export function useSaveFeedback(saveProjectExport: () => Promise<boolean>) {
  const latest = useOperations(
    (state) => state.operations.filter((op) => op.label === text.save).slice(-1)[0],
  );
  const [now, setNow] = useState(Date.now);
  const savingUntil = latest ? Math.max(latest.startedAt + 500, latest.finishedAt ?? 0) : 0;
  const successUntil = savingUntil + 2200;
  useEffect(() => {
    if (!latest || latest.status === "running") return;
    const tick = () => setNow(Date.now());
    tick();
    const floor = window.setTimeout(tick, Math.max(0, savingUntil - Date.now()));
    const success = window.setTimeout(tick, Math.max(0, successUntil - Date.now()));
    return () => {
      window.clearTimeout(floor);
      window.clearTimeout(success);
    };
  }, [latest, savingUntil, successUntil]);
  const isSaving = !!latest && (latest.status === "running" || now < savingUntil);
  const showSaveSuccess =
    !!latest &&
    !isSaving &&
    latest.status === "completed" &&
    latest.kind === "success" &&
    now < successUntil;
  return { isSaving, saveWithFeedback: saveProjectExport, showSaveSuccess };
}
