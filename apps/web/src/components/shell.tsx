'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { brand } from '@staydesk/config/brand';
import type { PropertyView, SessionInfo } from '@staydesk/contracts';
import { api, setCsrfToken } from '../lib/api-client';

export interface NavItem {
  href: string;
  label: string;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const active =
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`block rounded-md px-3 py-2 text-sm ${
        active
          ? 'bg-white/10 font-medium text-white'
          : 'text-white/75 hover:bg-white/5 hover:text-white'
      }`}
    >
      {item.label}
    </Link>
  );
}

function PropertySwitcher({
  properties,
  currentId,
}: {
  properties: PropertyView[];
  currentId: string | null;
}) {
  const router = useRouter();
  if (properties.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Property</span>
      <select
        value={currentId ?? ''}
        onChange={(e) => {
          // A UI preference, not a credential; the API still checks access on every request.
          document.cookie = `sd_property=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="max-w-[16rem] rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-sm"
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AccountMenu({ session }: { session: SessionInfo }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="hidden text-right sm:block">
        <div className="font-medium">{session.user.name}</div>
        <div className="text-xs text-[var(--text-muted)]">{session.current?.name}</div>
      </div>
      {session.options.length > 1 ? (
        <Link href="/choose-account" className="text-xs text-brand-600 hover:underline">
          Switch
        </Link>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            await api('POST', '/auth/logout');
          } finally {
            router.replace('/login');
            router.refresh();
          }
        }}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface)]"
      >
        Sign out
      </button>
    </div>
  );
}

/** The signed-in layout: sidebar navigation, property switcher and account menu (docs/07 §4.1). */
export function AppShell({
  session,
  nav,
  portalLabel,
  properties,
  currentPropertyId,
  children,
}: {
  session: SessionInfo;
  nav: NavItem[];
  portalLabel: string;
  properties?: PropertyView[];
  currentPropertyId?: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setCsrfToken(session.csrfToken), [session.csrfToken]);

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 bg-brand-900 p-4 transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Main navigation"
      >
        <div className="mb-6 flex items-center gap-2 px-2 text-white">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-white/10 font-semibold"
          >
            {brand.productName.charAt(0)}
          </span>
          <span className="font-semibold">{brand.productName}</span>
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80">
            {portalLabel}
          </span>
        </div>
        <nav className="space-y-0.5">
          {nav.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={() => setOpen(false)} />
          ))}
        </nav>
      </aside>
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)]/95 px-4 py-2.5 backdrop-blur lg:px-6">
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            Menu
          </button>
          {properties ? (
            <PropertySwitcher properties={properties} currentId={currentPropertyId ?? null} />
          ) : null}
          <div className="ml-auto">
            <AccountMenu session={session} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
