'use client';

import { useCallback, useState } from 'react';
import { ApiProblem, messageOf, type FieldErrors } from './api-client';

/** Shared submit handling: pending state, a form-level message and per-field errors. */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const run = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiProblem && Object.keys(e.fieldErrors).length > 0)
        setFieldErrors(e.fieldErrors);
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, fieldErrors, run, setError, setFieldErrors };
}
