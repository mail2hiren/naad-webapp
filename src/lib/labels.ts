/** Plain-language labels for database status codes, so screens never show
 * raw values like "awaiting_verification". */
const QUEUE_STATUS: Record<string, string> = {
  new: 'New',
  checking_in: 'Checking in',
  awaiting_verification: 'Details being checked',
  waiting_doctor: 'Waiting to be seen',
  with_doctor: 'In consultation',
  under_review: 'Under review',
  at_pharmacy: 'At pharmacy',
  admitted: 'Admitted',
  pending_discharge_clearance: 'Discharge payment pending',
  active_follow_up: 'Follow-up',
  done: 'Done',
};

export function queueStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return QUEUE_STATUS[status] ?? status.replace(/_/g, ' ');
}

const SUBSCRIPTION_STATUS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Cancelled',
};

export function subscriptionStatusLabel(status: string): string {
  return SUBSCRIPTION_STATUS[status] ?? status.replace(/_/g, ' ');
}
