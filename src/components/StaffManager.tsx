import { useState, type FormEvent } from 'react';
import { platformCall, type DepartmentRow, type StaffWithEmail } from '../lib/platformApi';
import { Btn, Card, Field, Modal, Pill, SectionHead, inputCls } from './ui';

const ROLE_LABEL: Record<string, string> = {
  receptionist: 'Receptionist', surgeon: 'Doctor', physio: 'Physiotherapist', pharmacist: 'Pharmacist', admin: 'Hospital admin',
};
const SPECIALTIES = ['Orthopedics', 'Physiotherapy', 'Critical Care'];

/** One-time password box: shown once, to be shared privately. */
export function TempPasswordNotice({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="text-sm bg-ok-soft text-ink rounded-lg px-4 py-3 leading-relaxed" data-testid="temp-password-notice" role="status">
      <div className="font-semibold text-ok mb-1">Login ready for {email}</div>
      Temp password: <span className="font-mono font-bold" data-testid="temp-password">{password}</span>
      <div className="text-ink-soft mt-1">
        Share it privately. It works once; they choose their own password when they first sign in. It won't be shown again.
      </div>
      <div className="mt-2 flex gap-2">
        <Btn
          type="button"
          variant="primary"
          className="!px-2"
          onClick={() => { navigator.clipboard?.writeText(password).then(() => setCopied(true), () => {}); }}
        >
          {copied ? 'Copied' : 'Copy password'}
        </Btn>
        <Btn type="button" variant="ghost" className="!px-2" onClick={onClose}>Done</Btn>
      </div>
    </div>
  );
}

/** Staff list for one hospital: add, reset password, deactivate. Used by the
 * Super admin console (any hospital) and a hospital admin (own hospital). */
export function StaffManager({
  orgId, staff, departments, seatLimit, onChanged,
}: {
  orgId: string;
  staff: StaffWithEmail[];
  departments: DepartmentRow[];
  seatLimit?: number;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ id: string; email: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeCount = staff.filter((s) => s.active).length;
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? '—';

  async function reset(s: StaffWithEmail) {
    setBusyId(s.id); setError(null);
    try {
      const r = await platformCall<{ tempPassword: string }>('reset_password', { practitionerId: s.id });
      setIssued({ id: s.id, email: s.email ?? s.name, password: r.tempPassword });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(s: StaffWithEmail) {
    setBusyId(s.id); setError(null);
    try {
      await platformCall('set_staff_active', { practitionerId: s.id, active: !s.active });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <SectionHead
          title="Staff"
          desc={seatLimit != null ? `${activeCount} of ${seatLimit} user seats in use. Each active staff login uses one seat.` : undefined}
        />
        <Btn variant="glow" onClick={() => setAdding(true)} data-testid="add-staff">+ Add staff</Btn>
      </div>
      {error && <div className="mb-3 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
      {issued && !staff.some((s) => s.id === issued.id) && (
        <div className="mb-3"><TempPasswordNotice email={issued.email} password={issued.password} onClose={() => setIssued(null)} /></div>
      )}
      <div className="flex flex-col divide-y divide-line">
        {staff.map((s) => (
          <div key={s.id} className="py-3 flex flex-col gap-2" data-testid="staff-row">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-semibold text-ink flex items-center gap-2 flex-wrap">
                  {s.name}
                  {!s.active && <Pill tone="danger">Deactivated</Pill>}
                </div>
                <div className="text-sm text-ink-soft">
                  {ROLE_LABEL[s.role] ?? s.role}
                  {s.specialty ? ` · ${s.specialty}` : ''}
                  {s.department_id && deptName(s.department_id) !== s.specialty ? ` · ${deptName(s.department_id)}` : ''}
                  {s.email ? ` · ${s.email}` : ''}
                </div>
              </div>
              <div className="flex gap-1">
                <Btn variant="default" data-testid="reset-password" disabled={busyId === s.id || !s.active} onClick={() => reset(s)}>
                  {busyId === s.id ? 'Working…' : 'Reset password'}
                </Btn>
                <Btn variant={s.active ? 'danger' : 'primary'} data-testid="toggle-staff-active" disabled={busyId === s.id} onClick={() => toggleActive(s)}>
                  {s.active ? 'Deactivate' : 'Reactivate'}
                </Btn>
              </div>
            </div>
            {issued?.id === s.id && <TempPasswordNotice email={issued.email} password={issued.password} onClose={() => setIssued(null)} />}
          </div>
        ))}
        {staff.length === 0 && <p className="text-ink-soft py-2">No staff yet.</p>}
      </div>
      {adding && (
        <AddStaffModal
          orgId={orgId}
          departments={departments.filter((d) => d.active)}
          onClose={() => setAdding(false)}
          onAdded={(email, password) => { setAdding(false); setIssued({ id: `new-${email}`, email, password }); onChanged(); }}
        />
      )}
    </Card>
  );
}

function AddStaffModal({
  orgId, departments, onClose, onAdded,
}: { orgId: string; departments: DepartmentRow[]; onClose: () => void; onAdded: (email: string, password: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'surgeon', title: '', specialty: '', departmentId: '', consultFee: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clinical = form.role === 'surgeon' || form.role === 'physio';
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const r = await platformCall<{ email: string; tempPassword: string }>('add_staff', { orgId, ...form });
      onAdded(r.email, r.tempPassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl mb-1">Add staff</h2>
      <p className="text-ink-soft text-sm mb-3">Creates their login. You'll get a one-time password to share with them.</p>
      <form onSubmit={submit}>
        <Field label="Full name"><input data-testid="staff-name" className={inputCls} value={form.name} onChange={set('name')} placeholder="e.g. Dr. Asha Rao" /></Field>
        <Field label="Email (their sign-in)"><input data-testid="staff-email" type="email" className={inputCls} value={form.email} onChange={set('email')} placeholder="name@hospital.com" /></Field>
        <Field label="Role">
          <select data-testid="staff-role" className={inputCls} value={form.role} onChange={set('role')}>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {clinical && (
          <>
            <Field label="Specialty">
              <select data-testid="staff-specialty" className={inputCls} value={form.specialty} onChange={set('specialty')}>
                <option value="">Choose…</option>
                {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select data-testid="staff-department" className={inputCls} value={form.departmentId} onChange={set('departmentId')}>
                <option value="">None</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Consultation fee (₹)"><input className={inputCls} inputMode="numeric" value={form.consultFee} onChange={set('consultFee')} placeholder="e.g. 800" /></Field>
          </>
        )}
        <Field label="Job title (optional)"><input className={inputCls} value={form.title} onChange={set('title')} placeholder="e.g. Senior Physiotherapist" /></Field>
        {error && <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
        <div className="mt-5 flex gap-2">
          <Btn type="submit" variant="glow" disabled={saving} data-testid="save-staff">{saving ? 'Creating login…' : 'Create login'}</Btn>
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </form>
    </Modal>
  );
}

/** Departments of one hospital: add, rename, switch off. */
export function DepartmentsManager({ orgId, departments, onChanged }: { orgId: string; departments: DepartmentRow[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(args: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      await platformCall('save_department', { orgId, ...args });
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await save({ name, specialty })) { setName(''); setSpecialty(''); }
  }

  return (
    <Card className="mb-6">
      <SectionHead title="Departments" desc="Departments organise doctors, queues and (soon) the appointment calendar." />
      {error && <div className="mb-3 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
      <div className="flex flex-col divide-y divide-line mb-4">
        {departments.map((d) => (
          <div key={d.id} className="py-2.5 flex items-center justify-between gap-3" data-testid="department-row">
            <div>
              <div className="font-semibold text-ink flex items-center gap-2">{d.name}{!d.active && <Pill tone="danger">Off</Pill>}</div>
              {d.specialty && <div className="text-sm text-ink-soft">{d.specialty}</div>}
            </div>
            <Btn variant={d.active ? 'ghost' : 'primary'} disabled={busy} onClick={() => save({ id: d.id, name: d.name, specialty: d.specialty ?? '', active: !d.active })}>
              {d.active ? 'Switch off' : 'Switch on'}
            </Btn>
          </div>
        ))}
        {departments.length === 0 && <p className="text-ink-soft py-2">No departments yet.</p>}
      </div>
      <form onSubmit={add} className="grid sm:grid-cols-[1fr_200px_auto] gap-2 items-end">
        <Field label="New department"><input data-testid="department-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sports Injury Clinic" /></Field>
        <Field label="Specialty">
          <select className={inputCls} value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            <option value="">General</option>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Btn type="submit" variant="glow" disabled={busy || !name.trim()} data-testid="add-department">Add</Btn>
      </form>
    </Card>
  );
}
