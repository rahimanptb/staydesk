'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { RoomTypeView } from '@staydesk/contracts';
import { api } from '../../lib/api-client';
import { checked, int, minorToMoney, moneyToMinor, optionalText, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { Checkbox, Section, Select, Textarea } from '../kit';
import { Alert, Button, Field } from '../ui';

/** Create or edit a room type. Edits send If-Match with the version loaded (docs/06 §1). */
export function RoomTypeForm({
  propertyId,
  currency,
  roomType,
  canManage,
  canSeeRates,
}: {
  propertyId: string;
  currency: string;
  roomType?: RoomTypeView;
  canManage: boolean;
  canSeeRates: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run, setFieldErrors } = useSubmit();
  const [trackRooms, setTrackRooms] = useState(roomType?.trackRooms ?? false);
  const r = roomType;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      name: text(form, 'name'),
      code: text(form, 'code'),
      description: optionalText(form, 'description'),
      maxAdults: int(form, 'maxAdults'),
      maxChildren: int(form, 'maxChildren'),
      maxOccupancy: int(form, 'maxOccupancy'),
      trackRooms: checked(form, 'trackRooms'),
      status: text(form, 'status'),
      sortOrder: int(form, 'sortOrder'),
      internalNotes: optionalText(form, 'internalNotes'),
    };
    if (!payload.trackRooms) payload.totalInventory = int(form, 'totalInventory');
    if (canSeeRates) {
      const rate = moneyToMinor(text(form, 'baseRate'), currency);
      if (Number.isNaN(rate)) {
        setFieldErrors({ baseRateMinor: 'Enter an amount like 6500 or 6500.50' });
        return;
      }
      payload.baseRateMinor = rate;
    }

    void run(async () => {
      if (r) {
        await api('PATCH', `/properties/${propertyId}/room-types/${r.id}`, payload, {
          headers: { 'if-match': `"v${r.version}"` },
        });
        router.refresh();
      } else {
        await api<RoomTypeView>('POST', `/properties/${propertyId}/room-types`, payload);
        router.push('/room-types');
        router.refresh();
      }
    });
  }

  const f = fieldErrors;
  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <fieldset disabled={!canManage} className="space-y-6">
        <Section title="Room type">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Name"
              name="name"
              defaultValue={r?.name}
              required
              placeholder="Deluxe Room"
              error={f.name}
            />
            <Field
              label="Code"
              name="code"
              defaultValue={r?.code}
              required
              maxLength={8}
              placeholder="DLX"
              error={f.code}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="Description"
                name="description"
                defaultValue={r?.description ?? ''}
              />
            </div>
            <Select
              label="Status"
              name="status"
              defaultValue={r?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive (not sold)' },
              ]}
            />
            <Field
              label="Display order"
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={r?.sortOrder ?? 0}
              error={f.sortOrder}
            />
          </div>
        </Section>

        <Section
          title="Occupancy"
          description="Per room. Guests may not exceed adults plus children."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Maximum adults"
              name="maxAdults"
              type="number"
              min={1}
              defaultValue={r?.maxAdults ?? 2}
              required
              error={f.maxAdults}
            />
            <Field
              label="Maximum children"
              name="maxChildren"
              type="number"
              min={0}
              defaultValue={r?.maxChildren ?? 1}
              required
              error={f.maxChildren}
            />
            <Field
              label="Maximum guests"
              name="maxOccupancy"
              type="number"
              min={1}
              defaultValue={r?.maxOccupancy ?? 3}
              required
              error={f.maxOccupancy}
            />
          </div>
        </Section>

        <Section title="Inventory">
          <div className="space-y-4">
            <Checkbox
              label="Track individual rooms"
              name="trackRooms"
              checked={trackRooms}
              onChange={(e) => setTrackRooms(e.target.checked)}
              hint="Add physical rooms (101, 102…) and assign them to bookings. The room count then sets the inventory."
            />
            {trackRooms ? (
              <p className="text-sm text-[var(--text-muted)]">
                Inventory:{' '}
                <span className="font-medium text-[var(--text)]">{r?.totalInventory ?? 0}</span>{' '}
                active room(s). Manage them on the Rooms page.
              </p>
            ) : (
              <div className="max-w-xs">
                <Field
                  label="Number of rooms"
                  name="totalInventory"
                  type="number"
                  min={0}
                  defaultValue={r?.totalInventory ?? 0}
                  required
                  error={f.totalInventory}
                />
              </div>
            )}
          </div>
        </Section>

        {canSeeRates ? (
          <Section
            title="Rate"
            description={`Base rate per night in ${currency}. Never shown to travel agents.`}
          >
            <div className="max-w-xs">
              <Field
                label={`Base rate (${currency})`}
                name="baseRate"
                inputMode="decimal"
                defaultValue={minorToMoney(r?.baseRateMinor, currency)}
                error={f.baseRateMinor}
              />
            </div>
          </Section>
        ) : null}

        <Section title="Internal notes" description="Visible to hotel staff only.">
          <Textarea label="Notes" name="internalNotes" defaultValue={r?.internalNotes ?? ''} />
        </Section>
      </fieldset>
      {canManage ? (
        <div className="max-w-xs">
          <Button pending={pending}>{r ? 'Save changes' : 'Create room type'}</Button>
        </div>
      ) : null}
    </form>
  );
}
