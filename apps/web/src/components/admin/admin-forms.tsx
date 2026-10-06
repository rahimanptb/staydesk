'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api-client';
import { text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { ActionButton } from '../actions';
import { Section, Select, StatusBadge, Table, Td } from '../kit';
import { Alert, Button, Field } from '../ui';

export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  entitlements: Array<{ key: string; intValue: number | null; boolValue: boolean | null }>;
}

const LIMITS = [
  { key: 'limit.properties', label: 'Properties' },
  { key: 'limit.rooms', label: 'Rooms' },
  { key: 'limit.staff', label: 'Staff members' },
  { key: 'limit.agencies', label: 'Travel agencies' },
] as const;

export function CreateTenantForm({ plans }: { plans: PlanSummary[] }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  const active = plans.filter((p) => p.isActive);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const trial = text(form, 'trialEndsAt');
    void run(async () => {
      await api('POST', '/platform/tenants', {
        name: text(form, 'name'),
        slug: text(form, 'slug'),
        country: text(form, 'country'),
        planId: text(form, 'planId'),
        ...(trial ? { trialEndsAt: new Date(`${trial}T23:59:59Z`).toISOString() } : {}),
        owner: { name: text(form, 'ownerName'), email: text(form, 'ownerEmail') },
      });
      router.push('/');
      router.refresh();
    });
  }

  if (active.length === 0) {
    return <Alert tone="info">Create a plan first: every tenant needs one.</Alert>;
  }
  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Section title="Account">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hotel or company name" name="name" required error={fieldErrors.name} />
          <Field
            label="Short name (slug)"
            name="slug"
            required
            hint="Lowercase letters, digits and hyphens"
            error={fieldErrors.slug}
          />
          <Field
            label="Country"
            name="country"
            defaultValue="IN"
            maxLength={2}
            required
            error={fieldErrors.country}
          />
          <Select
            label="Plan"
            name="planId"
            options={active.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Field label="Trial ends (optional)" name="trialEndsAt" type="date" />
        </div>
      </Section>
      <Section title="Owner" description="Receives an email invitation to set up the account.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner name" name="ownerName" required error={fieldErrors['owner.name']} />
          <Field
            label="Owner email"
            name="ownerEmail"
            type="email"
            required
            error={fieldErrors['owner.email']}
          />
        </div>
      </Section>
      <div className="max-w-xs">
        <Button pending={pending}>Create tenant and invite owner</Button>
      </div>
    </form>
  );
}

function PlanLimitsForm({ plan }: { plan: PlanSummary }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  const [saved, setSaved] = useState(false);
  const value = (key: string) => plan.entitlements.find((e) => e.key === key)?.intValue ?? '';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const known = new Set<string>(LIMITS.map((l) => l.key));
    const entitlements = [
      // Keep entitlements this form does not edit (feature flags etc.).
      ...plan.entitlements
        .filter((e) => !known.has(e.key))
        .map((e) =>
          e.intValue !== null
            ? { key: e.key, intValue: e.intValue }
            : { key: e.key, boolValue: e.boolValue },
        ),
      ...LIMITS.flatMap((l) => {
        const raw = text(form, l.key);
        return raw === '' ? [] : [{ key: l.key, intValue: Number(raw) }];
      }),
    ];
    setSaved(false);
    void run(async () => {
      await api('PUT', `/platform/plans/${plan.id}/entitlements`, { entitlements });
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">Limits saved.</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        {LIMITS.map((l) => (
          <Field
            key={l.key}
            label={l.label}
            name={l.key}
            type="number"
            min={0}
            defaultValue={value(l.key)}
            hint="Empty = unlimited"
          />
        ))}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface)] disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save limits'}
      </button>
    </form>
  );
}

export function PlansManager({ plans }: { plans: PlanSummary[] }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void run(async () => {
      await api('POST', '/platform/plans', { code: text(form, 'code'), name: text(form, 'name') });
      formElement.reset();
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Section
        title="New plan"
        description="Prices and billing come later; limits apply immediately."
      >
        <form
          onSubmit={onCreate}
          className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          noValidate
        >
          <Field label="Code" name="code" required placeholder="STARTER" error={fieldErrors.code} />
          <Field label="Name" name="name" required placeholder="Starter" error={fieldErrors.name} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create plan'}
          </button>
          {error ? (
            <div className="sm:col-span-3">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : null}
        </form>
      </Section>
      {plans.map((plan) => (
        <Section
          key={plan.id}
          title={`${plan.name} (${plan.code})`}
          actions={<StatusBadge status={plan.isActive ? 'ACTIVE' : 'INACTIVE'} />}
        >
          <PlanLimitsForm plan={plan} />
        </Section>
      ))}
    </div>
  );
}

export function TenantsTable({
  tenants,
  canManage,
}: {
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: { name: string } | null;
    createdAt: string;
  }>;
  canManage: boolean;
}) {
  return (
    <Table head={['Tenant', 'Plan', 'Status', 'Created', ...(canManage ? ['Actions'] : [])]}>
      {tenants.map((t) => (
        <tr key={t.id}>
          <Td>
            <div className="font-medium">{t.name}</div>
            <div className="text-xs text-[var(--text-muted)]">{t.slug}</div>
          </Td>
          <Td>{t.plan?.name ?? '—'}</Td>
          <Td>
            <StatusBadge status={t.status} />
          </Td>
          <Td className="text-xs tabular-nums text-[var(--text-muted)]">
            {t.createdAt.slice(0, 10)}
          </Td>
          {canManage ? (
            <Td>
              <div className="flex flex-wrap gap-2">
                {t.status !== 'ACTIVE' && t.status !== 'DEACTIVATED' ? (
                  <ActionButton
                    label="Activate"
                    path={`/platform/tenants/${t.id}/activate`}
                    reasonPrompt={`Why activate ${t.name}?`}
                  />
                ) : null}
                {t.status === 'ACTIVE' ? (
                  <ActionButton
                    label="Suspend"
                    path={`/platform/tenants/${t.id}/suspend`}
                    reasonPrompt={`Why suspend ${t.name}? Staff keep read-only access.`}
                  />
                ) : null}
                {t.status !== 'DEACTIVATED' ? (
                  <ActionButton
                    label="Deactivate"
                    tone="danger"
                    path={`/platform/tenants/${t.id}/deactivate`}
                    reasonPrompt={`Why deactivate ${t.name}? Everyone is signed out; data is kept.`}
                  />
                ) : null}
              </div>
            </Td>
          ) : null}
        </tr>
      ))}
    </Table>
  );
}
