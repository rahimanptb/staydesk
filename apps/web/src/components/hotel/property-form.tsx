'use client';

import { useRouter } from 'next/navigation';
import { useMemo, type FormEvent } from 'react';
import {
  AGENT_VISIBILITIES,
  PROPERTY_TYPES,
  type HolidayView,
  type PropertyView,
} from '@staydesk/contracts';
import { api } from '../../lib/api-client';
import { checked, int, optionalText, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { Checkbox, Section, Select } from '../kit';
import { Alert, Button, Field } from '../ui';
import { ActionButton } from '../actions';

const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll('_', ' ');
const VISIBILITY_LABELS: Record<string, string> = {
  FULL_BREAKDOWN: 'Full breakdown (total, booked, blocked, available)',
  EXACT_COUNT: 'Exact available count',
  CAPPED_COUNT: 'Capped count (e.g. "5+ available")',
  STATUS_ONLY: 'Status only (available / limited / unavailable)',
};

/** Create (no `property`) or edit property settings. */
export function PropertyForm({
  property,
  canManage,
}: {
  property?: PropertyView;
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  const timeZones = useMemo(
    () => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
    [],
  );
  const p = property;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      name: text(form, 'name'),
      type: text(form, 'type'),
      timezone: text(form, 'timezone'),
      currency: text(form, 'currency'),
      country: text(form, 'country'),
      addressLine1: optionalText(form, 'addressLine1'),
      addressLine2: optionalText(form, 'addressLine2'),
      city: optionalText(form, 'city'),
      region: optionalText(form, 'region'),
      postalCode: optionalText(form, 'postalCode'),
      phone: optionalText(form, 'phone'),
      email: optionalText(form, 'email'),
      checkInTime: text(form, 'checkInTime'),
      checkOutTime: text(form, 'checkOutTime'),
      childMaxAge: int(form, 'childMaxAge'),
      tentativeHoldHours: int(form, 'tentativeHoldHours'),
      lowAvailabilityThreshold: int(form, 'lowAvailabilityThreshold'),
      bookingHorizonDays: int(form, 'bookingHorizonDays'),
      maxStayNights: int(form, 'maxStayNights'),
      agentDefaultVisibility: text(form, 'agentDefaultVisibility'),
      agentCountCap: int(form, 'agentCountCap'),
      agentRequestExpiryHours: int(form, 'agentRequestExpiryHours'),
      isDiscoverable: checked(form, 'isDiscoverable'),
    };
    const prefix = text(form, 'bookingRefPrefix');
    if (prefix) payload.bookingRefPrefix = prefix;
    if (p) payload.status = text(form, 'status');
    else payload.code = text(form, 'code');

    void run(async () => {
      if (p) {
        await api('PATCH', `/properties/${p.id}`, payload);
        router.refresh();
      } else {
        const created = await api<PropertyView>('POST', '/properties', payload);
        document.cookie = `sd_property=${created.id}; path=/; max-age=31536000; samesite=lax`;
        router.push(`/properties/${created.id}`);
        router.refresh();
      }
    });
  }

  const f = fieldErrors;
  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <fieldset disabled={!canManage} className="space-y-6">
        <Section title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Property name"
              name="name"
              defaultValue={p?.name}
              required
              error={f.name}
            />
            {p ? (
              <Field
                label="Code"
                name="code-display"
                defaultValue={p.code}
                disabled
                hint="The code cannot change."
              />
            ) : (
              <Field
                label="Code"
                name="code"
                required
                maxLength={8}
                hint="2–8 letters or digits, e.g. GOA"
                error={f.code}
              />
            )}
            <Select
              label="Type"
              name="type"
              defaultValue={p?.type ?? 'HOTEL'}
              options={PROPERTY_TYPES.map((t) => ({ value: t, label: label(t) }))}
            />
            {p ? (
              <Select
                label="Status"
                name="status"
                defaultValue={p.status === 'DRAFT' ? 'DRAFT' : p.status}
                options={[
                  ...(p.status === 'DRAFT'
                    ? [{ value: 'DRAFT', label: 'Draft (not yet open)' }]
                    : []),
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
              />
            ) : null}
            <Field
              label="Booking reference prefix"
              name="bookingRefPrefix"
              defaultValue={p?.bookingRefPrefix}
              maxLength={8}
              hint={p ? 'Fixed once bookings exist.' : 'Defaults to the code.'}
              error={f.bookingRefPrefix}
            />
          </div>
        </Section>

        <Section title="Location and contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Time zone"
              name="timezone"
              list="timezones"
              defaultValue={p?.timezone ?? 'Asia/Kolkata'}
              required
              hint="Defines 'today' for bookings. Fixed once bookings exist."
              error={f.timezone}
            />
            <datalist id="timezones">
              {timeZones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <Field
              label="Currency"
              name="currency"
              defaultValue={p?.currency ?? 'INR'}
              maxLength={3}
              required
              hint="ISO code, e.g. INR. Fixed once bookings exist."
              error={f.currency}
            />
            <Field
              label="Country"
              name="country"
              defaultValue={p?.country ?? 'IN'}
              maxLength={2}
              required
              hint="2-letter code"
              error={f.country}
            />
            <Field label="Phone" name="phone" defaultValue={p?.phone ?? ''} error={f.phone} />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={p?.email ?? ''}
              error={f.email}
            />
            <Field
              label="Address line 1"
              name="addressLine1"
              defaultValue={p?.addressLine1 ?? ''}
            />
            <Field
              label="Address line 2"
              name="addressLine2"
              defaultValue={p?.addressLine2 ?? ''}
            />
            <Field label="City" name="city" defaultValue={p?.city ?? ''} />
            <Field label="State / region" name="region" defaultValue={p?.region ?? ''} />
            <Field label="Postal code" name="postalCode" defaultValue={p?.postalCode ?? ''} />
          </div>
        </Section>

        <Section title="Stay rules">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Check-in time"
              name="checkInTime"
              type="time"
              defaultValue={p?.checkInTime ?? '14:00'}
              error={f.checkInTime}
            />
            <Field
              label="Check-out time"
              name="checkOutTime"
              type="time"
              defaultValue={p?.checkOutTime ?? '11:00'}
              error={f.checkOutTime}
            />
            <Field
              label="Children up to age"
              name="childMaxAge"
              type="number"
              min={0}
              max={17}
              defaultValue={p?.childMaxAge ?? 12}
              error={f.childMaxAge}
            />
            <Field
              label="Tentative hold (hours)"
              name="tentativeHoldHours"
              type="number"
              min={1}
              max={336}
              defaultValue={p?.tentativeHoldHours ?? 48}
              hint="How long tentative bookings hold rooms."
              error={f.tentativeHoldHours}
            />
            <Field
              label="Low availability at"
              name="lowAvailabilityThreshold"
              type="number"
              min={0}
              defaultValue={p?.lowAvailabilityThreshold ?? 2}
              hint="Rooms left before showing 'low'."
              error={f.lowAvailabilityThreshold}
            />
            <Field
              label="Booking horizon (days)"
              name="bookingHorizonDays"
              type="number"
              min={1}
              max={1095}
              defaultValue={p?.bookingHorizonDays ?? 730}
              error={f.bookingHorizonDays}
            />
            <Field
              label="Maximum stay (nights)"
              name="maxStayNights"
              type="number"
              min={1}
              max={365}
              defaultValue={p?.maxStayNights ?? 90}
              error={f.maxStayNights}
            />
          </div>
        </Section>

        <Section
          title="Travel-agent defaults"
          description="What approved agencies see by default. You can change it per agency later."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Availability shown to agents"
              name="agentDefaultVisibility"
              defaultValue={p?.agentDefaultVisibility ?? 'FULL_BREAKDOWN'}
              options={AGENT_VISIBILITIES.map((v) => ({
                value: v,
                label: VISIBILITY_LABELS[v] ?? v,
              }))}
            />
            <Field
              label="Count cap (for capped counts)"
              name="agentCountCap"
              type="number"
              min={1}
              defaultValue={p?.agentCountCap ?? 5}
              error={f.agentCountCap}
            />
            <Field
              label="Booking requests expire after (hours)"
              name="agentRequestExpiryHours"
              type="number"
              min={1}
              max={720}
              defaultValue={p?.agentRequestExpiryHours ?? 24}
              error={f.agentRequestExpiryHours}
            />
            <Checkbox
              label="Let agencies find this property and request access"
              name="isDiscoverable"
              defaultChecked={p?.isDiscoverable ?? false}
            />
          </div>
        </Section>
      </fieldset>
      {canManage ? (
        <div className="max-w-xs">
          <Button pending={pending}>{p ? 'Save changes' : 'Create property'}</Button>
        </div>
      ) : null}
    </form>
  );
}

export function HolidaysPanel({
  propertyId,
  holidays,
  canManage,
}: {
  propertyId: string;
  holidays: HolidayView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void run(async () => {
      await api('POST', `/properties/${propertyId}/holidays`, {
        date: text(form, 'date'),
        name: text(form, 'name'),
      });
      formElement.reset();
      router.refresh();
    });
  }

  return (
    <Section title="Holidays and events" description="Shown on calendars and reports.">
      {holidays.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No holidays added yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] text-sm">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2">
              <span>
                <span className="font-medium tabular-nums">{h.date}</span> · {h.name}
              </span>
              {canManage && h.propertyId ? (
                <ActionButton
                  label="Remove"
                  method="DELETE"
                  path={`/properties/${propertyId}/holidays/${h.id}`}
                  tone="danger"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          onSubmit={onSubmit}
          className="mt-4 grid items-end gap-3 sm:grid-cols-[10rem_1fr_auto]"
          noValidate
        >
          <Field label="Date" name="date" type="date" required error={fieldErrors.date} />
          <Field label="Name" name="name" required error={fieldErrors.name} />
          <div>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface)] disabled:opacity-50"
            >
              {pending ? '…' : 'Add holiday'}
            </button>
          </div>
          {error ? (
            <div className="sm:col-span-3">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : null}
        </form>
      ) : null}
    </Section>
  );
}
