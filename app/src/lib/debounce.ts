/**
 * Creates a debounced version of the given function.
 *
 * - `flush()` — immediately executes the pending call (if any).
 * - `cancel()` — discards the pending call without executing.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): ((...args: Args) => void) & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Args | null = null;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  const flush = () => {
    if (timer && lastArgs) {
      clearTimeout(timer);
      timer = null;
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const debounced = (...args: Args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      lastArgs = null;
      fn(...args);
    }, delay);
  };

  debounced.flush = flush;
  debounced.cancel = cancel;
  return debounced;
}
