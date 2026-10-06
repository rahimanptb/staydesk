'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { RoomTypeView, StopSellView } from '@staydesk/contracts';
import { api } from '../../lib/api-client';
import { addDays } from '../../lib/dates';
import { optionalText, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { Section, Select } from '../kit';
import { Alert, Button, Field } from '../ui';

/** Close nights for sale without changing any counts (docs/08 §3). */
export function StopSellForm({
  propertyId,
  businessDate,
  roomTypes,
}: {
  propertyId: string;
  businessDate: string;
  roomTypes: RoomTypeView[];
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [done, setDone] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setDone(false);
    void run(async () => {
      const roomTypeId = text(form, 'roomTypeId');
      await api<StopSellView>('POST', `/properties/${propertyId}/stop-sells`, {
        roomTypeId: roomTypeId === '' ? null : roomTypeId,
        startDate: text(form, 'startDate'),
        endDate: text(form, 'endDate'),
        scope: text(form, 'scope'),
        reason: optionalText(form, 'reason'),
      });
      formElement.reset();
      setDone(true);
      router.refresh();
    });
  }

  return (
    <Section
      title="Stop selling"
      description="Closed nights stay visible on the calendar but cannot be booked through the chosen channel. Blocks are not affected."
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">Stop-sell saved.</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Room type"
            name="roomTypeId"
            options={[
              { value: '', label: 'All room types' },
              ...roomTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <Select
            label="Close to"
            name="scope"
            options={[
              { value: 'ALL_CHANNELS', label: 'Everyone (all sales)' },
              { value: 'AGENTS_ONLY', label: 'Travel agents only' },
            ]}
          />
          <Field
            label="From"
            name="startDate"
            type="date"
            min={businessDate}
            defaultValue={businessDate}
            required
            error={fieldErrors.startDate}
          />
          <Field
            label="Until (open again)"
            name="endDate"
            type="date"
            min={addDays(businessDate, 1)}
            defaultValue={addDays(businessDate, 1)}
            required
            error={fieldErrors.endDate}
          />
        </div>
        <div className="max-w-xl">
          <Field label="Reason (optional)" name="reason" error={fieldErrors.reason} />
        </div>
        <div className="max-w-xs">
          <Button pending={pending}>Stop selling</Button>
        </div>
      </form>
    </Section>
  );
}
