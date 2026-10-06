'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import type { ContextOption, InvitationPreview, SessionInfo, TotpSetup } from '@staydesk/contracts';
import { api, messageOf, setCsrfToken, type FieldErrors } from '../lib/api-client';
import { useSubmit } from '../lib/use-submit';
import { nextStepFor } from '../lib/routes';
import { Alert, Button, Field } from './ui';

/** Reads a token from the URL fragment (never sent to servers) and removes it from history. */
function useFragmentToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const value = window.location.hash.slice(1);
    setToken(/^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null);
    if (value) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return token;
}

function useGoNext() {
  const router = useRouter();
  return (session: SessionInfo) => {
    router.replace(nextStepFor(session));
    router.refresh();
  };
}

export function LoginForm() {
  const { pending, error, fieldErrors, run } = useSubmit();
  const goNext = useGoNext();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const session = await api<SessionInfo>('POST', '/auth/login', {
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      goNext(session);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        autoFocus
        error={fieldErrors.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldErrors.password}
      />
      <Button pending={pending}>Sign in</Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-brand-600 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    void run(async () => {
      await api('POST', '/auth/password/forgot', { email });
      setSent(true);
    });
  }

  if (sent) {
    return (
      <Alert tone="success">
        If an account exists for that email, we have sent a link to reset the password. It expires
        in 30 minutes.
      </Alert>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        autoFocus
        error={fieldErrors.email}
      />
      <Button pending={pending}>Send reset link</Button>
    </form>
  );
}

function NewPasswordFields({ errors }: { errors: FieldErrors }) {
  return (
    <>
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters. A few unrelated words make a strong password."
        error={errors.password}
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirm}
      />
    </>
  );
}

function readNewPassword(form: FormData): { password: string } | { error: FieldErrors } {
  const password = String(form.get('password') ?? '');
  if (password !== String(form.get('confirm') ?? ''))
    return { error: { confirm: 'The passwords do not match' } };
  return { password };
}

export function ResetPasswordForm() {
  const token = useFragmentToken();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [done, setDone] = useState(false);

  if (token === undefined) return null;
  if (token === null) {
    return (
      <Alert tone="error">
        This reset link is incomplete or invalid. Request a new one from the sign-in page.
      </Alert>
    );
  }
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success">
          Your password was changed. You have been signed out everywhere.
        </Alert>
        <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = readNewPassword(new FormData(event.currentTarget));
    if ('error' in parsed) return setLocalErrors(parsed.error);
    setLocalErrors({});
    void run(async () => {
      await api('POST', '/auth/password/reset', { token, password: parsed.password });
      setDone(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <NewPasswordFields errors={{ ...fieldErrors, ...localErrors }} />
      <Button pending={pending}>Change password</Button>
    </form>
  );
}

export function InvitationForm() {
  const token = useFragmentToken();
  const { pending, error, fieldErrors, run, setError } = useSubmit();
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<InvitationPreview>('POST', '/auth/invitations/preview', { token })
      .then(setPreview)
      .catch((e: unknown) => setError(messageOf(e)));
  }, [token, setError]);

  if (token === undefined) return null;
  if (token === null)
    return <Alert tone="error">This invitation link is incomplete or invalid.</Alert>;
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success">You&apos;re all set. Sign in to get started.</Alert>
        <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }
  if (!preview)
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <p className="text-sm text-[var(--text-muted)]">Checking your invitation…</p>
    );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let password: string;
    if (preview!.existingAccount) {
      password = String(form.get('password') ?? '');
    } else {
      const parsed = readNewPassword(form);
      if ('error' in parsed) return setLocalErrors(parsed.error);
      password = parsed.password;
    }
    setLocalErrors({});
    const name = String(form.get('name') ?? '').trim();
    void run(async () => {
      await api('POST', '/auth/invitations/accept', { token, password, ...(name ? { name } : {}) });
      setDone(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Alert tone="info">
        Join{' '}
        <strong className="font-semibold text-[var(--text)]">{preview.organizationName}</strong> as{' '}
        {preview.email}
      </Alert>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {preview.existingAccount ? (
        <Field
          label="Your current password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          hint="You already have an account; confirm it is you."
          error={fieldErrors.password}
        />
      ) : (
        <>
          <Field
            label="Your name"
            name="name"
            autoComplete="name"
            required
            autoFocus
            error={fieldErrors.name}
          />
          <NewPasswordFields errors={{ ...fieldErrors, ...localErrors }} />
        </>
      )}
      <Button pending={pending}>Accept invitation</Button>
    </form>
  );
}

export function TwoFactorForm({ csrfToken }: { csrfToken: string }) {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [useRecovery, setUseRecovery] = useState(false);
  const goNext = useGoNext();
  useEffect(() => setCsrfToken(csrfToken), [csrfToken]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    void run(async () => {
      const session = await api<SessionInfo>(
        'POST',
        '/auth/mfa/verify',
        useRecovery ? { recoveryCode: value } : { code: value },
      );
      goNext(session);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {useRecovery ? (
        <Field
          key="recovery"
          label="Recovery code"
          name="code"
          autoComplete="off"
          placeholder="ABCDE-12345"
          required
          autoFocus
          error={fieldErrors.recoveryCode}
        />
      ) : (
        <Field
          key="totp"
          label="6-digit code from your authenticator app"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          error={fieldErrors.code}
        />
      )}
      <Button pending={pending}>Verify</Button>
      <button
        type="button"
        onClick={() => setUseRecovery((v) => !v)}
        className="block w-full text-center text-sm text-brand-600 hover:underline"
      >
        {useRecovery ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
      </button>
    </form>
  );
}

export function TwoFactorSetup({ csrfToken, required }: { csrfToken: string; required: boolean }) {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const goNext = useGoNext();
  useEffect(() => setCsrfToken(csrfToken), [csrfToken]);

  function start() {
    void run(async () => {
      const result = await api<TotpSetup>('POST', '/auth/mfa/totp/setup');
      setSetup(result);
      setQr(await QRCode.toDataURL(result.otpauthUri, { margin: 1, width: 200 }));
    });
  }

  function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    void run(async () => {
      const result = await api<SessionInfo & { recoveryCodes: string[] }>(
        'POST',
        '/auth/mfa/totp/enable',
        { code },
      );
      setRecoveryCodes(result.recoveryCodes);
      setSession(result);
    });
  }

  if (recoveryCodes && session) {
    return (
      <div className="space-y-4">
        <Alert tone="success">Two-factor authentication is on.</Alert>
        <p className="text-sm">
          Save these recovery codes somewhere safe. Each can be used once if you lose your device.
          They will not be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-sm">
          {recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button type="button" onClick={() => goNext(session)}>
          I have saved my recovery codes
        </Button>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="text-sm text-[var(--text-muted)]">
          {required ? 'Your account requires two-factor authentication. ' : ''}
          You will need an authenticator app such as Google Authenticator, Microsoft Authenticator
          or 1Password.
        </p>
        <Button type="button" pending={pending} onClick={start}>
          Set up two-factor authentication
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onEnable} className="space-y-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p className="text-sm">
        Scan this code with your authenticator app, then enter the 6-digit code it shows.
      </p>
      {qr ? (
        // A locally generated data URL; next/image adds nothing here.
        <img
          src={qr}
          width={200}
          height={200}
          alt="QR code for your authenticator app"
          className="mx-auto rounded-md border border-[var(--border)]"
        />
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-brand-600">
          Can&apos;t scan? Enter this key instead
        </summary>
        <code className="mt-2 block break-all rounded-md bg-[var(--surface)] p-2 font-mono text-xs">
          {setup.secret}
        </code>
      </details>
      <Field
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        error={fieldErrors.code}
      />
      <Button pending={pending}>Turn on two-factor authentication</Button>
    </form>
  );
}

export function ChooseAccount({
  options,
  csrfToken,
  kind,
}: {
  options: ContextOption[];
  csrfToken: string;
  kind: 'tenant' | 'agency';
}) {
  const { pending, error, run } = useSubmit();
  const goNext = useGoNext();
  useEffect(() => setCsrfToken(csrfToken), [csrfToken]);

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="space-y-2">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  goNext(
                    await api<SessionInfo>(
                      'POST',
                      '/auth/context',
                      kind === 'tenant' ? { tenantId: option.id } : { agencyId: option.id },
                    ),
                  );
                })
              }
              className="flex w-full items-center justify-between rounded-md border border-[var(--border)] px-4 py-3 text-left text-sm hover:bg-[var(--surface)] disabled:opacity-60"
            >
              <span className="font-medium">{option.name}</span>
              {option.isOwner ? (
                <span className="text-xs text-[var(--text-muted)]">Owner</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SignOutButton({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  useEffect(() => setCsrfToken(csrfToken), [csrfToken]);
  return (
    <Button
      type="button"
      variant="secondary"
      pending={pending}
      onClick={async () => {
        setPending(true);
        try {
          await api('POST', '/auth/logout');
        } finally {
          router.replace('/login');
          router.refresh();
        }
      }}
    >
      Sign out
    </Button>
  );
}
