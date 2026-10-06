'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { brand } from '@staydesk/config/brand';

/** Centered card used by every sign-in / account screen. */
export function AuthCard({
  portalLabel,
  title,
  description,
  children,
  footer,
}: {
  portalLabel: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg bg-brand-900 text-base font-semibold text-white"
            >
              {brand.productName.charAt(0)}
            </span>
            <span className="text-lg font-semibold tracking-tight">{brand.productName}</span>
            <span className="ml-auto rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-muted)]">
              {portalLabel}
            </span>
          </div>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <div className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{description}</div>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? (
          <div className="mt-4 text-center text-sm text-[var(--text-muted)]">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

export function Field({
  label,
  error,
  hint,
  ...input
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="block w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25 aria-invalid:border-status-full"
        {...input}
      />
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

export function Button({
  pending,
  variant = 'primary',
  children,
  ...props
}: {
  pending?: boolean;
  variant?: 'primary' | 'secondary';
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles =
    variant === 'primary'
      ? 'bg-brand-600 text-white hover:bg-brand-900'
      : 'border border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface)]';
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
      className={`inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
      {...props}
    >
      {pending ? 'Please wait…' : children}
    </button>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-status-full/30 bg-status-full/5 text-status-full',
    success: 'border-status-available/30 bg-status-available/5 text-status-available',
    info: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}
