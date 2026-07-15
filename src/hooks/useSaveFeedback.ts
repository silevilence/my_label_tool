import { useEffect, useRef, useState } from "react";

const MIN_SAVE_FEEDBACK_MS = 500;
const SAVE_SUCCESS_MS = 1600;

export function useSaveFeedback(saveProjectExport: () => Promise<boolean>) {
  const successTimeoutRef = useRef<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  useEffect(
    () => () => {
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
      }
    },
    [],
  );

  async function saveWithFeedback() {
    if (isSaving) {
      return;
    }

    setShowSaveSuccess(false);
    setIsSaving(true);
    const [saved] = await Promise.all([saveProjectExport(), minDelay()]);
    setIsSaving(false);

    if (!saved) {
      return;
    }

    setShowSaveSuccess(true);
    if (successTimeoutRef.current !== null) {
      window.clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = window.setTimeout(() => {
      setShowSaveSuccess(false);
      successTimeoutRef.current = null;
    }, SAVE_SUCCESS_MS);
  }

  return { isSaving, saveWithFeedback, showSaveSuccess };
}

function minDelay(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, MIN_SAVE_FEEDBACK_MS));
}
