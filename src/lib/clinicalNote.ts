import type { ClinicalNote } from '../types/db';

/**
 * Coerces a soap-quadrant field into the bullet-list shape. Every encounter
 * saved before the 2026-09-03 Examination/Assessment bullet-list change has
 * these fields stored in Supabase as a plain paragraph string -- Supabase
 * returns jsonb untyped, so that legacy shape still comes back at runtime
 * even though `SoapSummary` now types both fields as `string[]`. Splitting
 * on line breaks (and stripping any leading "-"/"•" a doctor already typed)
 * turns old paragraph notes into bullets without dropping any text; a
 * single-line legacy value becomes a one-item list rather than being split
 * mid-sentence.
 */
export function toBullets(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-••]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Normalizes a clinical note freshly loaded from Supabase so every reader/
 * editor downstream can assume `soapSummary.examination`/`assessment` are
 * always `string[]`, regardless of whether the row predates the bullet-list
 * change. Call this once at the point a note is adopted as an editing
 * baseline (see DoctorView's encounter-adoption effect) -- reads elsewhere
 * that only touch one field in passing (history lists, the patient portal)
 * can call `toBullets()` directly instead of normalizing the whole note.
 */
export function normalizeClinicalNote(note: ClinicalNote | null | undefined): ClinicalNote | null {
  if (!note) return note ?? null;
  return {
    ...note,
    soapSummary: {
      ...note.soapSummary,
      examination: toBullets(note.soapSummary?.examination as unknown as string[] | string),
      assessment: toBullets(note.soapSummary?.assessment as unknown as string[] | string),
    },
  };
}
