import { useCallback, useRef, useState } from "react";
import {
  finishDraft,
  reduceDraft,
  type Draft,
  type DraftEvent,
  type GesturePoint,
} from "../lib/draft-gesture";
export function useDraftGesture() {
  const [draft, setDraft] = useState<Draft>({ kind: "idle" });
  const current = useRef(draft);
  const send = useCallback((event: DraftEvent) => {
    current.current = reduceDraft(current.current, event);
    setDraft(current.current);
  }, []);
  const start = useCallback(
    (intent: Extract<DraftEvent, { type: "start" }>["intent"], point: GesturePoint) =>
      send({ type: "start", intent, point }),
    [send],
  );
  const update = useCallback((point: GesturePoint) => send({ type: "update", point }), [send]);
  const interrupt = useCallback(() => send({ type: "interrupt" }), [send]);
  const cancel = useCallback(() => send({ type: "cancel" }), [send]);
  const endPan = useCallback(
    (cancelDraft: boolean) => send({ type: "end-pan", cancelDraft }),
    [send],
  );
  const commit = useCallback(() => {
    const result = finishDraft(current.current);
    if (current.current.kind !== "polygon" || result) cancel();
    return result;
  }, [cancel]);
  const undoVertex = useCallback(() => {
    if (current.current.kind !== "polygon") return false;
    send({ type: "undo" });
    return true;
  }, [send]);
  return { state: draft.kind, draft, start, update, commit, cancel, endPan, interrupt, undoVertex };
}
