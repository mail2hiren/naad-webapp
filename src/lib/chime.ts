/**
 * Audible alert tones via the Web Audio API -- no external audio asset to
 * host or bundle, and it works the same in dev, test, and production.
 * `playCriticalChime` (RED ALERT) is a sharper, louder, repeated tone;
 * `playSoftChime` (routine toast, e.g. "prescription authorized") is a
 * single gentle note.
 */
function beep(freq: number, durationMs: number, gain: number, delayMs = 0) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    setTimeout(() => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
      osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
      osc.onended = () => ctx.close().catch(() => {});
    }, delayMs);
  } catch {
    // Audio is a non-critical enhancement -- never let it break the app.
  }
}

export function playSoftChime() {
  beep(880, 180, 0.06);
}

export function playCriticalChime() {
  beep(1046, 220, 0.12, 0);
  beep(1046, 220, 0.12, 260);
  beep(1046, 220, 0.12, 520);
}
