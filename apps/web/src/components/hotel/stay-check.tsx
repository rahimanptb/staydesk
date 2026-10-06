'use client';

import { useState, type FormEvent } from 'react';
import type { AvailabilityQuote } from '@staydesk/contracts';
import { api } from '../../lib/api-client';
import { addDays, formatDate, formatRange } from '../../lib/dates';
import { int, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { Section, Table, Td } from '../kit';
import { Alert, Button, Field } from '../ui';
import { AVAILABILITY_STYLE } from './availability-grid';

/** A staff stay quote: which room types can take this party for these nights (docs/08 §9.2). */
export function StayCheck({
  propertyId,
  businessDate,
}: {
  propertyId: string;
  businessDate: string;
}) {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [quote, setQuote] = useState<AvailabilityQuote | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      setQuote(
        await api<AvailabilityQuote>('POST', `/properties/${propertyId}/availability/check`, {
          checkIn: text(form, 'checkIn'),
          checkOut: text(form, 'checkOut'),
          rooms: int(form, 'rooms'),
          adults: int(form, 'adults'),
          children: int(form, 'children'),
        }),
      );
    });
  }

  return (
    <Section
      title="Check a stay"
      description="Availability for every night of the stay, and whether the party fits. It is confirmed again when the booking is saved."
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-6 sm:items-end">
        <div className="sm:col-span-2">
          <Field
            label="Check-in"
            name="checkIn"
            type="date"
            defaultValue={businessDate}
            required
            error={fieldErrors.checkIn}
          />
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Check-out"
            name="checkOut"
            type="date"
            defaultValue={addDays(businessDate, 1)}
            required
            error={fieldErrors.checkOut}
          />
        </div>
        <Field label="Rooms" name="rooms" type="number" min={1} max={100} defaultValue={1} />
        <Field label="Adults" name="adults" type="number" min={1} max={500} defaultValue={2} />
        <Field label="Children" name="children" type="number" min={0} max={500} defaultValue={0} />
        <div className="sm:col-span-2">
          <Button pending={pending}>Check availability</Button>
        </div>
      </form>

      {error ? (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      {quote ? (
        <div className="mt-5 space-y-3" aria-live="polite">
          <p className="text-sm text-[var(--text-muted)]">
            {formatRange(quote.checkIn, quote.checkOut)} · {quote.rooms} room
            {quote.rooms === 1 ? '' : 's'}, {quote.adults} adult{quote.adults === 1 ? '' : 's'}
            {quote.children > 0
              ? `, ${quote.children} child${quote.children === 1 ? '' : 'ren'}`
              : ''}
          </p>
          {quote.results.length === 0 ? (
            <Alert tone="info">This property has no active room types.</Alert>
          ) : (
            <Table head={['Room type', 'Available', 'Status', 'Party fits', 'Result']}>
              {quote.results.map((r) => (
                <tr key={r.roomTypeId}>
                  <Td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-[var(--text-muted)]">{r.code}</div>
                  </Td>
                  <Td>
                    <span className="font-semibold tabular-nums">{Math.max(0, r.sellable)}</span>
                    {quote.nights > 1 ? (
                      <span className="block text-xs text-[var(--text-muted)]">
                        fewest on {formatDate(r.limitingDate)}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${AVAILABILITY_STYLE[r.status].cell}`}
                    >
                      {AVAILABILITY_STYLE[r.status].label}
                    </span>
                  </Td>
                  <Td>{r.occupancyFits ? 'Yes' : 'No — too many guests for this room type'}</Td>
                  <Td>
                    {r.canBook ? (
                      <span className="font-medium text-status-available">Can be booked</span>
                    ) : (
                      <span className="text-status-full">
                        {!r.occupancyFits
                          ? 'Does not fit'
                          : r.status === 'CLOSED'
                            ? 'Closed for sale'
                            : `Only ${Math.max(0, r.sellable)} available`}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      ) : null}
    </Section>
  );
}
