'use client';

import Link from 'next/link';
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

/** Design-system v1 building blocks for app pages (docs/07 §3). */

const control =
  'block w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25 aria-invalid:border-status-full';

function FieldShell({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-status-full">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) =>
  [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

export function Select({
  label,
  error,
  hint,
  options,
  ...props
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={control}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Textarea({
  label,
  error,
  hint,
  ...props
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={control}
        {...props}
      />
    </FieldShell>
  );
}

export function Checkbox({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-[var(--border)] accent-brand-600"
        {...props}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

const BADGE_TONES = {
  green: 'bg-status-available/10 text-status-available',
  amber: 'bg-status-low/10 text-status-low',
  red: 'bg-status-full/10 text-status-full',
  slate: 'bg-[var(--surface)] text-[var(--text-muted)]',
  blue: 'bg-brand-600/10 text-brand-600',
} as const;

const STATUS_TONE: Record<string, keyof typeof BADGE_TONES> = {
  ACTIVE: 'green',
  DRAFT: 'amber',
  INVITED: 'blue',
  TRIALING: 'blue',
  PENDING: 'amber',
  INACTIVE: 'slate',
  SUSPENDED: 'red',
  DEACTIVATED: 'slate',
  ARCHIVED: 'slate',
  REVOKED: 'slate',
};

/** One component, one meaning (docs/07 §1): status always renders the same way. */
export function StatusBadge({ status }: { status: string }) {
  const tone = BADGE_TONES[STATUS_TONE[status] ?? 'slate'];
  const label = status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' ');
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[var(--border)] bg-[var(--surface)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-middle ${className}`}>{children}</td>;
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const styles =
    variant === 'primary'
      ? 'bg-brand-600 text-white hover:bg-brand-900'
      : 'border border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface)]';
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${styles}`}
    >
      {children}
    </Link>
  );
}

export function SmallButton({
  children,
  onClick,
  tone = 'default',
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        tone === 'danger'
          ? 'border-status-full/30 text-status-full hover:bg-status-full/5'
          : 'border-[var(--border)] hover:bg-[var(--surface)]'
      }`}
    >
      {children}
    </button>
  );
}
