import { useCallback, useEffect, useRef, useState } from "react";

export function useTransientMessage(durationMs = 2200) {
  const timerRef = useRef<number | null>(null);
  const [message, setMessage] = useState("");

  const showMessage = useCallback(
    (nextMessage: string) => {
      setMessage(nextMessage);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = nextMessage
        ? window.setTimeout(() => {
            setMessage("");
            timerRef.current = null;
          }, durationMs)
        : null;
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { message, showMessage };
}
