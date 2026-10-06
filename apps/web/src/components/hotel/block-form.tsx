'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  BLOCK_REASONS,
  BLOCK_REASON_LABELS,
  type BlockView,
  type RoomTypeView,
  type RoomView,
} from '@staydesk/contracts';
import { ApiProblem, api } from '../../lib/api-client';
import { addDays, formatDate } from '../../lib/dates';
import { checked, int, optionalText, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { Checkbox, Section, Select, Textarea } from '../kit';
import { Alert, Button, Field } from '../ui';

interface Shortfall {
  date: string;
  requested: number;
  available: number;
}

/**
 * Create a block or out-of-service period. Each form instance has its own Idempotency-Key, so a
 * double click or a retry after a network error can never create two blocks (docs/06 §1).
 */
export function BlockForm({
  propertyId,
  businessDate,
  roomTypes,
  rooms,
  canBlock,
  canOutOfService,
  canOverride,
  initialRoomTypeId,
}: {
  propertyId: string;
  businessDate: string;
  roomTypes: RoomTypeView[];
  rooms: RoomView[];
  canBlock: boolean;
  canOutOfService: boolean;
  canOverride: boolean;
  initialRoomTypeId?: string | undefined;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<'BLOCK' | 'OUT_OF_SERVICE'>(
    canBlock ? 'BLOCK' : 'OUT_OF_SERVICE',
  );
  const [roomTypeId, setRoomTypeId] = useState(
    roomTypes.find((t) => t.id === initialRoomTypeId)?.id ?? roomTypes[0]?.id ?? '',
  );
  const [target, setTarget] = useState<'count' | 'room'>('count');
  const [override, setOverride] = useState(false);
  const [shortfall, setShortfall] = useState<Shortfall[]>([]);

  const type = roomTypes.find((t) => t.id === roomTypeId);
  const typeRooms = rooms.filter((r) => r.roomTypeId === roomTypeId && r.status === 'ACTIVE');
  const roomSpecific = target === 'room' && typeRooms.length > 0;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setShortfall([]);
    void run(async () => {
      try {
        await api<BlockView>(
          'POST',
          `/properties/${propertyId}/blocks`,
          {
            kind,
            roomTypeId,
            ...(roomSpecific
              ? { roomId: text(form, 'roomId'), quantity: 1 }
              : { quantity: int(form, 'quantity') }),
            startDate: text(form, 'startDate'),
            endDate: text(form, 'endDate'),
            reason: text(form, 'reason'),
            notes: optionalText(form, 'notes'),
            ...(checked(form, 'override')
              ? { override: { reason: text(form, 'overrideReason') } }
              : {}),
          },
          { headers: { 'idempotency-key': idempotencyKey } },
        );
        setIdempotencyKey(crypto.randomUUID());
        router.push('/blocks');
        router.refresh();
      } catch (e) {
        if (e instanceof ApiProblem && Array.isArray(e.meta.shortfall)) {
          setShortfall(e.meta.shortfall as Shortfall[]);
        }
        throw e;
      }
    });
  }

  if (roomTypes.length === 0) {
    return <Alert tone="info">Add a room type before blocking rooms.</Alert>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {error ? (
        <Alert tone="error">
          {error}
          {shortfall.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {shortfall.slice(0, 10).map((s) => (
                <li key={s.date}>
                  {formatDate(s.date)}: {s.available} available, {s.requested} requested
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <Section title="What">
        <fieldset className="space-y-4">
          <legend className="sr-only">Kind</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {canBlock ? (
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kind"
                  value="BLOCK"
                  checked={kind === 'BLOCK'}
                  onChange={() => setKind('BLOCK')}
                  className="accent-brand-600"
                />
                Block — hold rooms back from sale (groups, owner use)
              </label>
            ) : null}
            {canOutOfService ? (
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kind"
                  value="OUT_OF_SERVICE"
                  checked={kind === 'OUT_OF_SERVICE'}
                  onChange={() => setKind('OUT_OF_SERVICE')}
                  className="accent-brand-600"
                />
                Out of service — rooms that cannot be used (maintenance, renovation)
              </label>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Room type"
              name="roomTypeId"
              value={roomTypeId}
              onChange={(e) => {
                setRoomTypeId(e.target.value);
                setTarget('count');
              }}
              options={roomTypes.map((t) => ({
                value: t.id,
                label: `${t.name} (${t.totalInventory})`,
              }))}
            />
            <Select
              label="Reason"
              name="reason"
              defaultValue={kind === 'BLOCK' ? 'GROUP_RESERVATION' : 'MAINTENANCE'}
              key={kind}
              options={BLOCK_REASONS.map((r) => ({ value: r, label: BLOCK_REASON_LABELS[r] }))}
            />
          </div>
          {typeRooms.length > 0 ? (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="target"
                  value="count"
                  checked={target === 'count'}
                  onChange={() => setTarget('count')}
                  className="accent-brand-600"
                />
                A number of rooms
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="target"
                  value="room"
                  checked={target === 'room'}
                  onChange={() => setTarget('room')}
                  className="accent-brand-600"
                />
                A specific room
              </label>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {roomSpecific ? (
              <Select
                label="Room"
                name="roomId"
                error={fieldErrors.roomId}
                hint="The room cannot be assigned to guests on these dates."
                options={typeRooms.map((r) => ({ value: r.id, label: `Room ${r.number}` }))}
              />
            ) : (
              <Field
                label="Number of rooms"
                name="quantity"
                type="number"
                min={1}
                max={type?.totalInventory ?? 10_000}
                defaultValue={1}
                required
                error={fieldErrors.quantity}
              />
            )}
          </div>
        </fieldset>
      </Section>

      <Section
        title="When"
        description="From the first night to the day the rooms are back, like check-in and check-out."
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
            label="Until (rooms available again)"
            name="endDate"
            type="date"
            min={addDays(businessDate, 1)}
            defaultValue={addDays(businessDate, 1)}
            required
            error={fieldErrors.endDate}
          />
        </div>
        <div className="mt-4">
          <Textarea label="Notes" name="notes" error={fieldErrors.notes} />
        </div>
      </Section>

      {canOverride ? (
        <Section title="Override">
          <Checkbox
            label="Exceed availability if needed"
            name="override"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            hint="Only when overbooking is allowed for your account. The reason is kept in the audit log."
          />
          {override ? (
            <div className="mt-4 max-w-xl">
              <Field
                label="Reason for the override"
                name="overrideReason"
                required
                error={fieldErrors['override.reason']}
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      <div className="max-w-xs">
        <Button pending={pending}>
          {kind === 'BLOCK' ? 'Block rooms' : 'Take out of service'}
        </Button>
      </div>
    </form>
  );
}
