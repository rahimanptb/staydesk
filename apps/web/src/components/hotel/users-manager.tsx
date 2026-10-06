'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { MembershipView, PropertyView, RoleView } from '@staydesk/contracts';
import { api } from '../../lib/api-client';
import { checked, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { ActionButton } from '../actions';
import { Checkbox, Section, Select, StatusBadge, Table, Td } from '../kit';
import { Alert, Field } from '../ui';

function InviteForm({ roles, properties }: { roles: RoleView[]; properties: PropertyView[] }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [allProperties, setAllProperties] = useState(true);
  const [sent, setSent] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const propertyIds = properties
      .filter((p) => checked(form, `property-${p.id}`))
      .map((p) => p.id);
    const email = text(form, 'email');
    void run(async () => {
      await api('POST', '/users/invitations', {
        email,
        name: text(form, 'name'),
        roleId: text(form, 'roleId'),
        allProperties,
        propertyIds: allProperties ? [] : propertyIds,
      });
      formElement.reset();
      setAllProperties(true);
      setSent(email);
      router.refresh();
    });
  }

  const defaultRole = roles.find((r) => r.key === 'HOTEL_STAFF')?.id;
  return (
    <Section
      title="Invite a team member"
      description="They receive an email to set their password. Invitations expire after 72 hours."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {sent ? <Alert tone="success">Invitation sent to {sent}.</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" name="name" required error={fieldErrors.name} />
          <Field label="Email" name="email" type="email" required error={fieldErrors.email} />
          <Select
            label="Role"
            name="roleId"
            defaultValue={defaultRole}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>
        <Checkbox
          label="Access to all properties"
          checked={allProperties}
          onChange={(e) => setAllProperties(e.target.checked)}
        />
        {!allProperties ? (
          <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-3">
            <legend className="px-1 text-sm font-medium">Properties</legend>
            {properties.map((p) => (
              <Checkbox key={p.id} label={p.name} name={`property-${p.id}`} />
            ))}
            {fieldErrors.propertyIds ? (
              <p className="text-xs text-status-full">{fieldErrors.propertyIds}</p>
            ) : null}
          </fieldset>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Send invitation'}
        </button>
      </form>
    </Section>
  );
}

function RoleSelect({ member, roles }: { member: MembershipView; roles: RoleView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <select
        aria-label={`Role of ${member.user.name}`}
        defaultValue={member.role.id}
        onChange={async (e) => {
          setError(null);
          try {
            await api('PATCH', `/users/${member.id}`, { roleId: e.target.value });
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not change the role');
            e.target.value = member.role.id;
          }
        }}
        className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-sm"
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="max-w-xs text-xs text-status-full">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function UsersManager({
  members,
  roles,
  properties,
  currentUserId,
  canManage,
}: {
  members: MembershipView[];
  roles: RoleView[];
  properties: PropertyView[];
  currentUserId: string;
  canManage: boolean;
}) {
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  return (
    <div className="space-y-6">
      {canManage ? <InviteForm roles={roles} properties={properties} /> : null}
      <Table head={['Name', 'Role', 'Properties', 'Status', ...(canManage ? ['Actions'] : [])]}>
        {members.map((m) => {
          const self = m.user.id === currentUserId;
          return (
            <tr key={m.id}>
              <Td>
                <div className="font-medium">
                  {m.user.name}{' '}
                  {m.isOwner ? (
                    <span className="text-xs font-normal text-[var(--text-muted)]">· Owner</span>
                  ) : null}
                </div>
                <div className="text-xs text-[var(--text-muted)]">{m.user.email}</div>
              </Td>
              <Td>{canManage && !self ? <RoleSelect member={m} roles={roles} /> : m.role.name}</Td>
              <Td className="text-xs text-[var(--text-muted)]">
                {m.allProperties
                  ? 'All properties'
                  : m.propertyIds.map((id) => propertyName.get(id) ?? 'Unknown').join(', ')}
              </Td>
              <Td>
                <StatusBadge status={m.status} />
              </Td>
              {canManage ? (
                <Td>
                  {self ? (
                    <span className="text-xs text-[var(--text-muted)]">You</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {m.status === 'ACTIVE' ? (
                        <ActionButton
                          label="Suspend"
                          path={`/users/${m.id}/suspend`}
                          confirm={`Suspend ${m.user.name}? They will be signed out at once.`}
                        />
                      ) : null}
                      {m.status === 'SUSPENDED' ? (
                        <ActionButton label="Reactivate" path={`/users/${m.id}/reactivate`} />
                      ) : null}
                      <ActionButton
                        label="Remove"
                        tone="danger"
                        path={`/users/${m.id}/revoke`}
                        confirm={`Remove ${m.user.name} from this account?`}
                      />
                    </div>
                  )}
                </Td>
              ) : null}
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
