import { supabase } from './supabaseClient';

/** Calls the platform-admin edge function (Super admin console, and hospital
 * admins managing their own staff). Returns the JSON body, or throws an Error
 * whose message is safe to show on screen. */
export async function platformCall<T = Record<string, unknown>>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('platform-admin', { body: { action, ...args } });
  if (error) {
    let message = 'Something went wrong. Please try again.';
    try {
      const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  return data as T;
}

export interface HospitalSummary {
  id: string;
  name: string;
  city: string | null;
  plan: string;
  subscription_status: string;
  seat_limit: number;
  ai_monthly_budget_usd: number;
  address: string | null;
  contact_phone: string | null;
  billing_email: string | null;
  seats_used: number;
  patient_count: number;
  ai_spent_this_month: number;
}

export interface DepartmentRow {
  id: string;
  org_id: string;
  name: string;
  specialty: string | null;
  active: boolean;
}

export interface StaffWithEmail {
  id: string;
  org_id: string;
  name: string;
  role: string;
  title: string | null;
  specialty: string | null;
  department_id: string | null;
  consult_fee: number | null;
  active: boolean;
  email: string | null;
}

export interface AuditEvent {
  id: number;
  ts: string;
  actor: string;
  actor_role: string;
  action: string;
  org_id: string | null;
  detail: string | null;
}
