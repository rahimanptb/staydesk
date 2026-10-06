'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, messageOf } from '../lib/api-client';
import { SmallButton } from './kit';

/**
 * A button that calls the API after an optional confirmation (or a reason prompt), then refreshes
 * or navigates. Errors are shown next to the button.
 */
export function ActionButton({
  label,
  path,
  method = 'POST',
  body,
  confirm,
  reasonPrompt,
  tone = 'default',
  redirectTo,
}: {
  label: string;
  path: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  confirm?: string;
  /** Asks for a reason and sends it as { reason }. */
  reasonPrompt?: string;
  tone?: 'default' | 'danger';
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    let payload = body;
    if (reasonPrompt) {
      const reason = window.prompt(reasonPrompt)?.trim();
      if (!reason) return;
      payload = { reason };
    } else if (confirm && !window.confirm(confirm)) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api(method, path, payload);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <SmallButton tone={tone} onClick={onClick} disabled={pending}>
        {pending ? '…' : label}
      </SmallButton>
      {error ? (
        <span role="alert" className="max-w-xs text-xs text-status-full">
          {error}
        </span>
      ) : null}
    </span>
  );
}
