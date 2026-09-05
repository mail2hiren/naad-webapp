import { useCallback, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * useRealAmbientCapture -- the real ambient AI pipeline, finally wired into
 * this app. Records actual microphone audio (or accepts typed text as a
 * fallback), uploads it to the `transcribe-and-extract` Supabase Edge
 * Function, and returns the same real Deepgram-diarized transcript +
 * Claude-structured extraction the old vanilla-JS showcase already proved
 * out live (real invocations logged in `ai_usage_log`, 2026-08-24 to
 * 2026-08-27) -- that pipeline was simply never ported into this React
 * rewrite. `webapp/src` had zero `getUserMedia`/`MediaRecorder`/
 * `functions.invoke('transcribe-and-extract')` calls before this file;
 * every "Start Dictation" / "Start Ambient AI Registration" button only
 * ever played back a scripted transcript through a regex keyword matcher
 * (see `useAmbientIntake.ts`). This hook is the real thing, modeled
 * directly on the working reference implementation in
 * `app/digiyaan-live.html` (search "REAL AMBIENT AI (online mode)").
 *
 * Deliberately NOT used in mock mode (`VITE_USE_MOCK=1`) -- callers must
 * check `isMockBackend` themselves and keep the existing scripted/simulated
 * path there, since there is no real backend to call in CI/local dev and
 * headless test runners have no microphone anyway. This keeps every
 * existing Playwright test's behavior byte-for-byte unchanged.
 */

export type CaptureStage = 'reception' | 'consult' | 'physio';

export interface ExtractUsage {
  deepgramMinutes: number;
  claudeTokens: number;
  estimatedCostUsd: number;
  spentThisMonth: number;
  budget: number;
}

export interface ExtractResult {
  extracted: Record<string, unknown>;
  diarizedText: string;
  transcriptId: string;
  usage: ExtractUsage;
}

export type CaptureStatus = 'idle' | 'recording' | 'processing' | 'error';

interface CaptureError {
  message: string;
  /** 'budget_exceeded' | 'no_speech' | 'server_config' | 'auth' | 'network' | 'unknown' */
  kind: string;
}

/** True when the browser can actually record audio -- mirrors the guard the
 * old showcase used before ever touching getUserMedia. */
export function micSupported(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined';
}

export function useRealAmbientCapture(opts: {
  stage: CaptureStage;
  patientId: string | null;
  encounterId?: string | null;
}) {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [error, setError] = useState<CaptureError | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopResolveRef = useRef<((blob: Blob) => void) | null>(null);

  function teardownStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }

  /** Low-level POST to the edge function, shared by the mic path (an audio
   * Blob) and the typed-text fallback (plain text, no audio) -- same shape
   * as the old showcase's `postToAI` helper. */
  const postToAI = useCallback(async (body: Blob | string): Promise<ExtractResult> => {
    if (!opts.patientId) throw { kind: 'unknown', message: 'No patient selected yet.' } as CaptureError;

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw { kind: 'auth', message: 'Your session has expired -- please sign in again.' } as CaptureError;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const isTyped = typeof body === 'string';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': isTyped ? 'text/plain' : (body.type || 'audio/webm'),
      'x-stage': opts.stage,
      'x-patient-id': opts.patientId,
    };
    if (opts.encounterId) headers['x-encounter-id'] = opts.encounterId;

    let res: Response;
    try {
      res = await fetch(`${supabaseUrl}/functions/v1/transcribe-and-extract`, {
        method: 'POST',
        headers,
        body,
      });
    } catch {
      throw { kind: 'network', message: 'Could not reach the AI service -- check your connection and try again, or type the note manually.' } as CaptureError;
    }

    if (!res.ok) {
      let payload: { error?: string; message?: string } = {};
      try { payload = await res.json(); } catch { /* non-JSON error body */ }
      if (res.status === 402) {
        throw { kind: 'budget_exceeded', message: payload.message || 'This month\'s AI budget has been reached -- please type this note manually.' } as CaptureError;
      }
      if (res.status === 422) {
        throw { kind: 'no_speech', message: payload.message || 'No speech was detected -- please try again or type the note.' } as CaptureError;
      }
      if (res.status === 500 && /secret/i.test(payload.error || '')) {
        throw { kind: 'server_config', message: 'Real ambient AI isn\'t configured yet on the server (missing API keys) -- please type this note manually.' } as CaptureError;
      }
      if (res.status === 401 || res.status === 403) {
        throw { kind: 'auth', message: payload.error || 'Not authorized to record for this patient.' } as CaptureError;
      }
      throw { kind: 'unknown', message: payload.error || payload.message || `AI extraction failed (${res.status}).` } as CaptureError;
    }

    return res.json();
  }, [opts.stage, opts.patientId, opts.encounterId]);

  const start = useCallback(async () => {
    setError(null);
    if (!micSupported()) {
      setError({ kind: 'unknown', message: 'Voice input isn\'t supported in this browser -- please type the note instead.' });
      setStatus('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        stopResolveRef.current?.(blob);
        stopResolveRef.current = null;
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setStatus('recording');
    } catch {
      setError({ kind: 'unknown', message: 'Couldn\'t access the microphone -- please allow mic access, or type the note instead.' });
      setStatus('error');
      teardownStream();
    }
  }, []);

  /** Stops recording, uploads the audio, and returns the real extraction --
   * or null if anything failed (with `error` set for the caller to surface
   * via a toast). Never throws, so a failed AI call can never block the
   * consultation workflow -- the doctor/reception can always fall back to
   * typing, exactly like the reference implementation. */
  const stop = useCallback(async (): Promise<ExtractResult | null> => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return null;
    setStatus('processing');
    try {
      const blob = await new Promise<Blob>((resolve) => {
        stopResolveRef.current = resolve;
        mr.stop();
      });
      teardownStream();
      if (blob.size === 0) {
        setError({ kind: 'no_speech', message: 'No audio was captured -- please try again or type the note.' });
        setStatus('error');
        return null;
      }
      const result = await postToAI(blob);
      setStatus('idle');
      return result;
    } catch (e) {
      teardownStream();
      const err = e as CaptureError;
      setError(err.kind ? err : { kind: 'unknown', message: 'AI extraction failed -- please type the note manually.' });
      setStatus('error');
      return null;
    }
  }, [postToAI]);

  const cancel = useCallback(() => {
    const mr = mediaRecorderRef.current;
    stopResolveRef.current = null;
    if (mr && mr.state !== 'inactive') mr.stop();
    teardownStream();
    setStatus('idle');
    setError(null);
  }, []);

  /** Typed-text fallback -- skips Deepgram entirely, sends straight to
   * Claude for the same structured extraction. Real, budget-tracked, and
   * audited exactly like the recorded path (the old showcase added this
   * after a live session showed the client falling back to a blank note
   * whenever someone typed instead of recording). */
  const submitTypedText = useCallback(async (text: string): Promise<ExtractResult | null> => {
    if (!text.trim()) return null;
    setError(null);
    setStatus('processing');
    try {
      const result = await postToAI(text);
      setStatus('idle');
      return result;
    } catch (e) {
      const err = e as CaptureError;
      setError(err.kind ? err : { kind: 'unknown', message: 'AI extraction failed -- please write the note manually.' });
      setStatus('error');
      return null;
    }
  }, [postToAI]);

  return { status, error, start, stop, cancel, submitTypedText, supported: micSupported() };
}
