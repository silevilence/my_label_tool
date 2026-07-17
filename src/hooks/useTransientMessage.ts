import { useRef, useState } from "react";

export function useTransientMessage(durationMs = 2200) {
  const timerRef = useRef<number | null>(null);
  const [message, setMessage] = useState("");

  function showMessage(nextMessage: string) {
    setMessage(nextMessage);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => setMessage(""), durationMs);
  }

  return { message, showMessage };
}
