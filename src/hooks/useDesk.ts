import { useOrgTable } from './useOrgTable';
import type {
  AdmissionRow, CashClosingRow, EnquiryRow, FollowUpRow, InsuranceClaimRow, PatientContactRow, PatientPackageRow, TreatmentPackageRow,
} from '../types/desk';

const num = <T,>(keys: (keyof T)[]) => (r: T) => {
  const o = { ...r } as Record<string, unknown>;
  keys.forEach((k) => { if (o[k as string] != null) o[k as string] = Number(o[k as string]); });
  return o as T;
};

/** The front-desk tables from migration 0020, each kept live. */
export function useFollowUps(orgId: string) { return useOrgTable<FollowUpRow>('follow_ups', orgId).rows; }
export function useContacts(orgId: string) { return useOrgTable<PatientContactRow>('patient_contacts', orgId).rows; }
export function useEnquiries(orgId: string) { return useOrgTable<EnquiryRow>('enquiries', orgId).rows; }
export function useAdmissions(orgId: string) { return useOrgTable<AdmissionRow>('admissions', orgId, num<AdmissionRow>(['deposit'])).rows; }
export function useClaims(orgId: string) {
  return useOrgTable<InsuranceClaimRow>('insurance_claims', orgId, num<InsuranceClaimRow>(['amount_requested', 'amount_approved', 'amount_settled'])).rows;
}
export function useCashClosings(orgId: string) {
  return useOrgTable<CashClosingRow>('cash_closings', orgId, num<CashClosingRow>(['expected_cash', 'counted_cash', 'expected_upi', 'expected_card', 'expected_insurance', 'refunds_cash', 'difference'])).rows;
}
export function usePackageTypes(orgId: string) { return useOrgTable<TreatmentPackageRow>('treatment_packages', orgId, num<TreatmentPackageRow>(['price'])).rows; }
export function usePatientPackages(orgId: string) { return useOrgTable<PatientPackageRow>('patient_packages', orgId, num<PatientPackageRow>(['price'])).rows; }
