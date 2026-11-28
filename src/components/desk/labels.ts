import type { ContactOutcome } from '../../types/desk';

export const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  booked: 'Booked', no_answer: 'No answer', call_later: 'Call later', declined: 'Not coming', wrong_number: 'Wrong number', informed: 'Told them', other: 'Other',
};

export const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
