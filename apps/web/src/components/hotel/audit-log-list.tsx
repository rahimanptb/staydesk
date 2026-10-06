'use client';

import { useState } from 'react';
import type { AuditLogView } from '@staydesk/contracts';
import { api, messageOf } from '../../lib/api-client';
import { Alert } from '../ui';

interface Page {
  data: AuditLogView[];
  nextCursor: string | null;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** Newest first, with "Load more" using the API's cursor. */
export function AuditLogList({ initial }: { initial: Page }) {
  const [entries, setEntries] = useState(initial.data);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setPending(true);
    setError(null);
    try {
      const page = await api<Page>(
        'GET',
        `/audit-logs?limit=50&cursor=${encodeURIComponent(cursor)}`,
      );
      setEntries((e) => [...e, ...page.data]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }

  if (entries.length === 0)
    return <p className="text-sm text-[var(--text-muted)]">Nothing has been recorded yet.</p>;
  return (
    <div className="space-y-4">
      <ol className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
        {entries.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <div className="text-sm">{e.summary}</div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">
              <time dateTime={e.createdAt}>{when(e.createdAt)}</time> · <code>{e.action}</code>
            </div>
          </li>
        ))}
      </ol>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface)] disabled:opacity-60"
        >
          {pending ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
