export type PlayerAutosaveOptions = {
  intervalMs: number;
  save: () => void;
  onError: (error: unknown) => void;
  schedule?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  cancel?: (timer: ReturnType<typeof setInterval>) => void;
};

export function startPlayerAutosave(options: PlayerAutosaveOptions): () => void {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) {
    throw new Error('Player autosave interval must be a positive integer.');
  }

  const schedule = options.schedule ?? setInterval;
  const cancel = options.cancel ?? clearInterval;
  const timer = schedule(() => {
    try {
      options.save();
    } catch (error) {
      options.onError(error);
    }
  }, options.intervalMs);

  // Autosave must not keep an otherwise idle process alive during shutdown.
  timer.unref?.();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    cancel(timer);
  };
}
