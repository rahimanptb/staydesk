'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { RoomTypeView, RoomView } from '@staydesk/contracts';
import { api } from '../../lib/api-client';
import { optionalText, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { ActionButton } from '../actions';
import { Section, Select, StatusBadge, Table, Td } from '../kit';
import { Alert, Field } from '../ui';

/** Expands "101-105" style ranges (with an optional prefix) or a comma/space separated list. */
export function roomNumbersFrom(input: {
  mode: 'range' | 'list';
  from: string;
  to: string;
  prefix: string;
  list: string;
}): string[] | string {
  if (input.mode === 'list') {
    const numbers = input.list
      .split(/[\s,]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    return numbers.length ? numbers : 'Enter at least one room number';
  }
  const from = Number(input.from);
  const to = Number(input.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from)
    return 'Enter a valid range, e.g. 101 to 120';
  if (to - from >= 500) return 'Add at most 500 rooms at a time';
  const width = input.from.trim().length;
  return Array.from(
    { length: to - from + 1 },
    (_, i) => `${input.prefix}${String(from + i).padStart(width, '0')}`,
  );
}

function AddRoomsForm({
  propertyId,
  roomTypes,
}: {
  propertyId: string;
  roomTypes: RoomTypeView[];
}) {
  const router = useRouter();
  const { pending, error, run, setError } = useSubmit();
  const [mode, setMode] = useState<'range' | 'list'>('range');

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const numbers = roomNumbersFrom({
      mode,
      from: text(form, 'from'),
      to: text(form, 'to'),
      prefix: text(form, 'prefix'),
      list: text(form, 'list'),
    });
    if (typeof numbers === 'string') return setError(numbers);
    const floor = optionalText(form, 'floor');
    void run(async () => {
      await api('POST', `/properties/${propertyId}/rooms`, {
        roomTypeId: text(form, 'roomTypeId'),
        rooms: numbers.map((number) => ({ number, floor })),
      });
      formElement.reset();
      router.refresh();
    });
  }

  return (
    <Section
      title="Add rooms"
      description="Rooms can only be added to room types that track individual rooms."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Room type"
            name="roomTypeId"
            options={roomTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Select
            label="How to enter numbers"
            name="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'range' | 'list')}
            options={[
              { value: 'range', label: 'A range (101 to 120)' },
              { value: 'list', label: 'A list (101, 102, 105A)' },
            ]}
          />
          <Field label="Floor (optional)" name="floor" />
        </div>
        {mode === 'range' ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Prefix (optional)" name="prefix" placeholder="V" />
            <Field label="From" name="from" inputMode="numeric" required placeholder="101" />
            <Field label="To" name="to" inputMode="numeric" required placeholder="120" />
          </div>
        ) : (
          <Field label="Room numbers" name="list" required placeholder="101, 102, 103, 105A" />
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add rooms'}
        </button>
      </form>
    </Section>
  );
}

export function RoomsManager({
  propertyId,
  roomTypes,
  rooms,
  canManage,
}: {
  propertyId: string;
  roomTypes: RoomTypeView[];
  rooms: RoomView[];
  canManage: boolean;
}) {
  const tracked = roomTypes.filter((t) => t.trackRooms && t.status !== 'ARCHIVED');
  return (
    <div className="space-y-6">
      {canManage && tracked.length > 0 ? (
        <AddRoomsForm propertyId={propertyId} roomTypes={tracked} />
      ) : null}
      {tracked.map((type) => {
        const ofType = rooms.filter((r) => r.roomTypeId === type.id);
        return (
          <Section
            key={type.id}
            title={type.name}
            description={`${type.totalInventory} active of ${ofType.length} room(s)`}
          >
            {ofType.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No rooms yet.</p>
            ) : (
              <Table head={['Room', 'Floor', 'Status', ...(canManage ? ['Actions'] : [])]}>
                {ofType.map((room) => (
                  <tr key={room.id}>
                    <Td className="font-medium tabular-nums">{room.number}</Td>
                    <Td>{room.floor ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={room.status} />
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex flex-wrap gap-2">
                          <ActionButton
                            label={room.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            method="PATCH"
                            path={`/properties/${propertyId}/rooms/${room.id}`}
                            body={{ status: room.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }}
                          />
                          <ActionButton
                            label="Archive"
                            tone="danger"
                            path={`/properties/${propertyId}/rooms/${room.id}/archive`}
                            confirm={`Archive room ${room.number}? It will no longer be sold or assigned.`}
                          />
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        );
      })}
    </div>
  );
}
