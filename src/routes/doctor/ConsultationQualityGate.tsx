import { useState } from 'react';
import { Btn, BulletListEditor, Pill, inputCls } from '../../components/ui';
import type { ClinicalNote, PrescriptionItem, Specialty } from '../../types/db';

/**
 * Consultation Wrap-Up / Human-in-the-Loop Sign-Off (Clinical_User_Stories
 * rows 3.3 + 3.4 + 3.5, combined into one continuous screen): stopping
 * dictation "auto-formats text models into 4 distinct quadrants" (3.3),
 * which this renders as a FULL-SCREEN overlay locking the base app
 * viewport (3.4 -- previously this was a small centered Modal; a full
 * `fixed inset-0` panel is what "locks the base viewport" actually means),
 * with all 4 SOAP quadrants as large editable textareas so the sign-off is
 * a genuine review step, not just the omission check. Below that sits the
 * Omission Check (3.5): a handful of specialty-specific heuristics against
 * the CURRENT draft clinical note + prescription, surfacing anything that
 * looks administratively incomplete (missing food-timing instructions, no
 * follow-up scheduled, SpO2 monitoring not documented, ...). Every flag
 * gets a one-click AI fix AND a manual override -- the doctor always stays
 * the final decision-maker (HITL), and "Close" is always available even
 * with flags outstanding. This is a nudge, never a lock: nothing here
 * blocks Authorize & Route (3.6), which lives outside this overlay.
 */
export type FixKind = 'food-instruction' | 'append-precaution' | 'rehab-frequency' | 'append-dos-donts';
export interface QualityFlag {
  id: string;
  label: string;
  fixKind: FixKind;
  fixText: string;
}

function computeFlags(
  specialty: Specialty | null,
  note: ClinicalNote,
  items: PrescriptionItem[],
): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const precautions = note.precautions ?? [];
  const dosAndDonts = note.dosAndDonts ?? [];
  const rehabExercises = note.rehabExercises ?? [];

  if (specialty === 'Orthopedics') {
    const hasFoodTiming = items.length > 0 && items.some((i) => /meal/i.test(i.foodInstruction ?? ''));
    if (!hasFoodTiming) {
      flags.push({
        id: 'ortho-food-timing',
        label: 'Food-timing instructions not specified for pain medication',
        fixKind: 'food-instruction',
        fixText: 'Take after meals',
      });
    }
    if (precautions.length === 0) {
      flags.push({
        id: 'ortho-followup-imaging',
        label: 'Follow-up imaging date not scheduled',
        fixKind: 'append-precaution',
        fixText: 'Schedule follow-up X-ray in 2 weeks',
      });
    }
  } else if (specialty === 'Physiotherapy') {
    const allHaveFrequency = rehabExercises.length > 0 && rehabExercises.every((e) => !!e.frequencyPerWeek);
    if (!allHaveFrequency) {
      flags.push({
        id: 'physio-frequency',
        label: 'Exercise frequency not specified for one or more rehab exercises',
        fixKind: 'rehab-frequency',
        fixText: '2x/week',
      });
    }
    if (precautions.length === 0) {
      flags.push({
        id: 'physio-followup',
        label: 'Follow-up reassessment date not scheduled',
        fixKind: 'append-precaution',
        fixText: 'Reassess pain levels in 1 week',
      });
    }
  } else if (specialty === 'Critical Care') {
    const mentionsSpO2 = precautions.some((p) => /spo2|oxygen/i.test(p));
    if (!mentionsSpO2) {
      flags.push({
        id: 'cc-spo2',
        label: 'SpO2 monitoring instructions missing from precautions',
        fixKind: 'append-precaution',
        fixText: 'Maintain SpO2 between 92-96%; escalate if below 90%',
      });
    }
    if (dosAndDonts.length === 0) {
      flags.push({
        id: 'cc-dosdonts',
        label: 'Discharge safety checklist not documented',
        fixKind: 'append-dos-donts',
        fixText: 'Confirm emergency contact details before discharge',
      });
    }
  }
  return flags;
}

export function ConsultationQualityGate({
  specialty,
  clinicalNote,
  prescriptionItems,
  onUpdateNote,
  onApplyFix,
  onDismiss,
  onClose,
}: {
  specialty: Specialty | null;
  clinicalNote: ClinicalNote;
  prescriptionItems: PrescriptionItem[];
  onUpdateNote: (patch: Partial<ClinicalNote>) => void;
  onApplyFix: (flag: QualityFlag) => void;
  onDismiss: (flag: QualityFlag, overrideText?: string) => void;
  onClose: () => void;
}) {
  const [handledIds, setHandledIds] = useState<Set<string>>(new Set());
  const [openOverrideId, setOpenOverrideId] = useState<string | null>(null);
  const [overrideText, setOverrideText] = useState('');

  const flags = computeFlags(specialty, clinicalNote, prescriptionItems).filter((f) => !handledIds.has(f.id));

  function applyFix(flag: QualityFlag) {
    onApplyFix(flag);
    setHandledIds((prev) => new Set(prev).add(flag.id));
  }

  function saveOverride(flag: QualityFlag) {
    onDismiss(flag, overrideText.trim() || undefined);
    setHandledIds((prev) => new Set(prev).add(flag.id));
    setOpenOverrideId(null);
    setOverrideText('');
  }

  return (
    <div
      data-testid="signoff-overlay"
      className="fixed inset-0 z-50 overflow-y-auto bg-bg"
    >
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-10">
        <div className="flex items-center justify-between mb-1">
          <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">Human-in-the-Loop Sign-Off</div>
          <Pill tone={flags.length === 0 ? 'ok' : 'gate'}>{flags.length === 0 ? 'All Clear' : `${flags.length} Flag${flags.length === 1 ? '' : 's'}`}</Pill>
        </div>
        <h2 className="text-lg mb-1.5">Before you route this consult</h2>
        <p className="text-ink-faint text-xs font-light mb-5 leading-relaxed">
          Dictation has stopped and the note has been formatted into 4 quadrants. Review and edit each one, resolve any
          administrative flags below, then close to return and authorize. Nothing here blocks you from authorizing.
        </p>

        {/* ---- Row 3.4: the 4 SOAP quadrants, large and editable -- the
            same underlying note as the Session & Note tab (shared
            onUpdateNote), so edits here and there stay in sync. --------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <SignOffQuadrant
            label="History"
            value={clinicalNote.soapSummary.history}
            onChange={(v) => onUpdateNote({ soapSummary: { ...clinicalNote.soapSummary, history: v } })}
          />
          <SignOffBulletQuadrant
            label="Examination"
            items={clinicalNote.soapSummary.examination}
            onChange={(v) => onUpdateNote({ soapSummary: { ...clinicalNote.soapSummary, examination: v } })}
          />
          <SignOffBulletQuadrant
            label="Assessment"
            items={clinicalNote.soapSummary.assessment}
            onChange={(v) => onUpdateNote({ soapSummary: { ...clinicalNote.soapSummary, assessment: v } })}
          />
          <SignOffQuadrant
            label="Plan"
            value={clinicalNote.soapSummary.plan}
            onChange={(v) => onUpdateNote({ soapSummary: { ...clinicalNote.soapSummary, plan: v } })}
          />
        </div>

        <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink mb-2">Omission Check</div>

      {flags.length === 0 ? (
        <div className="bg-ok-soft text-ok rounded-lg px-3 py-3 text-sm font-semibold mb-2">
          No missing-data flags detected for this draft.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 mb-2">
          {flags.map((flag) => (
            <div key={flag.id} className="bg-surface-2 border border-line rounded-lg p-3">
              <div className="text-sm text-ink mb-2.5 leading-snug">{flag.label}</div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  data-testid="apply-ai-fix"
                  onClick={() => applyFix(flag)}
                  className="text-ok border border-ok/50 bg-ok-soft"
                >
                  Apply AI Fix
                </Btn>
                <Btn
                  data-testid="dismiss-override"
                  className="text-ink-faint border border-danger/40"
                  onClick={() => setOpenOverrideId(openOverrideId === flag.id ? null : flag.id)}
                >
                  Dismiss / Manual Override
                </Btn>
              </div>
              {openOverrideId === flag.id && (
                <div className="mt-2.5 pt-2.5 border-t border-line">
                  <textarea
                    className={`${inputCls} min-h-[64px]`}
                    placeholder="Write a manual note to record instead (appended to precautions)..."
                    value={overrideText}
                    onChange={(e) => setOverrideText(e.target.value)}
                  />
                  <div className="flex justify-end mt-2">
                    <Btn variant="primary" onClick={() => saveOverride(flag)}>Save Override</Btn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

        <div className="flex justify-end mt-4 pt-3 border-t border-line pb-6">
          <Btn variant="glow" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

function SignOffQuadrant({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">{label}</span>
      <textarea
        className={`${inputCls} min-h-[110px]`}
        data-testid={`signoff-${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Examination/Assessment quadrant on the sign-off screen -- bullet list,
 * matching the Session & Note tab's editor (same underlying array field,
 * same interaction), so review here looks exactly like what was written
 * during the consult instead of collapsing it back into a paragraph box. */
function SignOffBulletQuadrant({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div data-testid={`signoff-${label.toLowerCase()}`}>
      <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">{label}</span>
      <BulletListEditor items={items} onChange={onChange} emptyLabel={`No ${label.toLowerCase()} points added yet.`} />
    </div>
  );
}
