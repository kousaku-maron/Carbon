import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyFeedback<T extends string>(durationMs = 1500) {
  const [copied, setCopied] = useState<T | false>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissCopied = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setCopied(false);
  }, []);

  const showCopied = useCallback(
    (kind: T) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setCopied(kind);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setCopied(false);
      }, durationMs);
    },
    [durationMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    copied,
    showCopied,
    dismissCopied,
  } as const;
}
