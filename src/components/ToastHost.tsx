import { useEffect, useState } from 'react';
import { useClinic, type Toast } from '../context/ClinicContext';

const FALLBACK_TOP = 16; // matches the old `top-4` for header-less routes (/login, /patient)
const GAP_BELOW_HEADER = 12;
const MOBILE_QUERY = '(max-width: 639px)'; // matches Tailwind's `sm` breakpoint

/**
 * Anchors the toast stack just below Shell's sticky header instead of at a
 * hardcoded viewport offset. This codebase has broken toast positioning
 * twice before by assuming a fixed top/bottom offset -- Shell's header is
 * `flex-wrap`, so on a narrow phone viewport a role with workspace-nav
 * (surgeon/admin) wraps onto a second line and grows taller than a
 * single-line header (receptionist/pharmacist). A fixed `top-4` sits the
 * pill directly on top of the brand mark, nav pills, and Sign Out button
 * on every route -- confirmed visually in QA screenshots -- so the offset
 * is measured from the real header element instead.
 *
 * Falls back to FALLBACK_TOP when no <header> is present (the login gate,
 * the patient portal) and re-attaches on route changes, since Shell's
 * header element is mounted/unmounted by React Router rather than resized
 * in place.
 */
function useHeaderOffset(): number {
  const [offset, setOffset] = useState<number>(FALLBACK_TOP);

  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let currentHeader: HTMLElement | null = null;

    function attach(header: HTMLElement | null) {
      ro?.disconnect();
      ro = null;
      currentHeader = header;
      if (!header) {
        setOffset(FALLBACK_TOP);
        return;
      }
      const update = () => setOffset(header.getBoundingClientRect().height + GAP_BELOW_HEADER);
      update();
      ro = new ResizeObserver(update);
      ro.observe(header);
    }

    attach(document.querySelector('header'));

    // Route changes swap Shell's <header> in and out of the DOM (no header
    // on /login or /patient) -- watch for that so the offset re-attaches
    // to the new page's header instead of going stale after navigation.
    const mo = new MutationObserver(() => {
      const header = document.querySelector('header');
      if (header !== currentHeader) attach(header);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
  }, []);

  return offset;
}

/**
 * Mobile phones get their own placement problem the header-offset math
 * above can't solve: on a narrow viewport, roles with workspace-nav
 * (surgeon/physio/admin) wrap Shell's header onto a second line, and
 * whatever the toast is measured to sit just below -- the patient queue's
 * first row, a chart's own name/heading -- is exactly what a doctor needs
 * to read in the same instant. Confirmed with mobile-viewport screenshots
 * (2026-09-03): the pill was landing squarely on top of queue entries and
 * page titles for its full 4s hold. Rather than chase the header's exact
 * wrapped height on every phone size, mobile toasts anchor to the BOTTOM
 * safe area instead -- the standard placement for transient
 * snackbar/toast UI on phones, and one that structurally can't collide
 * with the header no matter how many lines it wraps to. Desktop/tablet
 * keeps the existing below-header placement, which has no such problem.
 */
function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsNarrow(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return isNarrow;
}

/** Status-dot color per tone -- this is now the ONLY thing that varies
 * per-tone (the pill itself is a single, uniform glass treatment); colors
 * are pulled from the app's own design tokens, not generic Tailwind slate,
 * so this stays inside the existing dark neomorphic palette:
 * emerald (--ok) for authorization/completion events, indigo (--aura-1,
 * the same hue the ambient orb opens on) for front-desk/queue events,
 * amber (--gate) for escalation/query events, and the app's established
 * danger red (--danger) for critical/urgent triage. */
const DOT_TONE: Record<Toast['tone'], string> = {
  critical: 'bg-danger shadow-[0_0_10px_2px_var(--danger)]',
  warning: 'bg-gate shadow-[0_0_10px_2px_var(--gate)]',
  ok: 'bg-ok shadow-[0_0_10px_2px_var(--ok)]',
  info: 'bg-aura-1 shadow-[0_0_10px_2px_var(--aura-1)]',
};

const HOLD_MS = 4000;
const EXIT_MS = 300;

/** One floating glass pill: mounts in its off-screen/faded state, flips to
 * "entered" on the next frame (so the slide-down/fade-in actually animates
 * instead of snapping straight to visible), holds for exactly 4s, then
 * reverses the same transition to slide back up and fade out before
 * actually leaving the toasts list. */
function ToastPill({
  toast: t, onDismiss, fromBottom,
}: { toast: Toast; onDismiss: (id: string) => void; fromBottom: boolean }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const holdTimer = setTimeout(() => setEntered(false), HOLD_MS);
    const removeTimer = setTimeout(() => onDismiss(t.id), HOLD_MS + EXIT_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(holdTimer); clearTimeout(removeTimer); };
  }, [t.id, onDismiss]);

  function handleManualDismiss() {
    setEntered(false);
    setTimeout(() => onDismiss(t.id), EXIT_MS);
  }

  // Slides down into place from the header on desktop/tablet; slides up
  // from the safe area on mobile, matching whichever edge it's anchored to.
  const hiddenTransform = fromBottom ? 'translate-y-6' : '-translate-y-6';

  return (
    <div
      role={t.tone === 'critical' ? 'alert' : undefined}
      className={`pointer-events-auto backdrop-blur-md bg-bg/80 border border-line-strong rounded-2xl py-2.5 px-5 shadow-[0_12px_40px_rgba(0,0,0,0.5)] flex items-center gap-3 max-w-[min(420px,calc(100vw-2rem))] transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
        entered ? 'translate-y-0 opacity-100' : `${hiddenTransform} opacity-0`
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 animate-pulse ${DOT_TONE[t.tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-ink break-words">{t.title}</div>
        {t.detail && <div className="text-xs text-ink-soft mt-0.5 break-words">{t.detail}</div>}
      </div>
      <button onClick={handleManualDismiss} aria-label="Dismiss notification" className="text-ink-faint hover:text-ink text-xs shrink-0 min-h-11 min-w-11">✕</button>
    </div>
  );
}

/** Global toast/alert host, mounted once in App.tsx -- renders every
 * pushToast() call from ClinicContext (RED ALERT triage, doctor-query
 * paging, stock substitution flags, prescription-authorized pharmacy
 * alerts) as a stack of slim glass pills floating at the top safe area.
 *
 * The outer stack is `pointer-events-none` and only each rendered pill is
 * `pointer-events-auto`, so -- unlike the previous full-width bottom bar,
 * which spanned an entire tab strip and made it briefly unclickable --
 * nothing on the page can ever be blocked except the small area directly
 * behind a visible pill itself. */
export default function ToastHost() {
  const { toasts, dismissToast } = useClinic();
  const top = useHeaderOffset();
  const isNarrow = useIsNarrowViewport();
  // The live region stays mounted even when empty: screen readers only
  // announce changes inside a region that already existed.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="fixed inset-x-4 z-50 flex flex-col items-center gap-2 pointer-events-none"
      style={isNarrow ? { bottom: 'max(1rem, env(safe-area-inset-bottom))' } : { top }}
    >
      {toasts.map((t) => (
        <ToastPill key={t.id} toast={t} onDismiss={dismissToast} fromBottom={isNarrow} />
      ))}
    </div>
  );
}
