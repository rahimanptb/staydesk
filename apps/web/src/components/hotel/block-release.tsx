'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { BlockReleaseResult, BlockView } from '@staydesk/contracts';
import { api } from '../../lib/api-client';
import { addDays } from '../../lib/dates';
import { int, text } from '../../lib/forms';
import { useSubmit } from '../../lib/use-submit';
import { SmallButton } from '../kit';
import { Button, Field } from '../ui';

/** Release all or part of a block: from a date, and/or some of its rooms (BL-02). */
export function BlockRelease({
  propertyId,
  block,
  businessDate,
}: {
  propertyId: string;
  block: BlockView;
  businessDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, run } = useSubmit();
  const earliest = block.startDate > businessDate ? block.startDate : businessDate;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      // Only blocks of several rooms ask how many to release; otherwise all of them.
      const quantity = !block.roomId && block.quantity > 1 ? int(form, 'quantity') : undefined;
      await api<BlockReleaseResult>(
        'POST',
        `/properties/${propertyId}/blocks/${block.id}/release`,
        {
          fromDate: text(form, 'fromDate'),
          ...(quantity !== undefined && quantity !== block.quantity ? { quantity } : {}),
          reason: text(form, 'reason'),
        },
      );
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) return <SmallButton onClick={() => setOpen(true)}>Release</SmallButton>;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="w-72 space-y-3 rounded-lg border border-[var(--border)] p-3"
    >
      <Field
        label="Release from"
        name="fromDate"
        type="date"
        min={earliest}
        max={addDays(block.endDate, -1)}
        defaultValue={earliest}
        hint="Earlier nights stay as they were."
        error={fieldErrors.fromDate}
      />
      {!block.roomId && block.quantity > 1 ? (
        <Field
          label={`Rooms to release (of ${block.quantity})`}
          name="quantity"
          type="number"
          min={1}
          max={block.quantity}
          defaultValue={block.quantity}
          error={fieldErrors.quantity}
        />
      ) : null}
      <Field label="Reason" name="reason" required error={fieldErrors.reason} />
      {error ? (
        <p role="alert" className="text-xs text-status-full">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button pending={pending}>Release</Button>
        <SmallButton onClick={() => setOpen(false)}>Cancel</SmallButton>
      </div>
    </form>
  );
}
