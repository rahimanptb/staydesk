'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api-client';
import { checked, optionalText, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { Checkbox, Section } from '../kit';
import { Alert, Button, Field } from '../ui';

export interface TenantProfile {
  name: string;
  legalName: string | null;
  billingEmail: string | null;
  requireStaff2fa: boolean;
  overbookingEnabled: boolean;
}

export function TenantSettingsForm({
  tenant,
  canManage,
}: {
  tenant: TenantProfile;
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [saved, setSaved] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);
    void run(async () => {
      await api('PATCH', '/tenant', {
        name: text(form, 'name'),
        legalName: optionalText(form, 'legalName'),
        billingEmail: optionalText(form, 'billingEmail'),
        requireStaff2fa: checked(form, 'requireStaff2fa'),
        overbookingEnabled: checked(form, 'overbookingEnabled'),
      });
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">Settings saved.</Alert> : null}
      <fieldset disabled={!canManage} className="space-y-6">
        <Section title="Account">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Account name"
              name="name"
              defaultValue={tenant.name}
              required
              error={fieldErrors.name}
            />
            <Field label="Legal name" name="legalName" defaultValue={tenant.legalName ?? ''} />
            <Field
              label="Billing email"
              name="billingEmail"
              type="email"
              defaultValue={tenant.billingEmail ?? ''}
              error={fieldErrors.billingEmail}
            />
          </div>
        </Section>
        <Section title="Security">
          <Checkbox
            label="Require two-factor authentication for all staff"
            name="requireStaff2fa"
            defaultChecked={tenant.requireStaff2fa}
            hint="Staff without it are asked to set it up at their next sign-in."
          />
        </Section>
        <Section title="Inventory">
          <Checkbox
            label="Allow authorised overbooking"
            name="overbookingEnabled"
            defaultChecked={tenant.overbookingEnabled}
            hint="People with the override permission may then exceed availability, giving a reason. Every override is recorded in the audit log."
          />
        </Section>
      </fieldset>
      {canManage ? (
        <div className="max-w-xs">
          <Button pending={pending}>Save settings</Button>
        </div>
      ) : null}
    </form>
  );
}
