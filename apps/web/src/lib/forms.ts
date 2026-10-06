/** Helpers to turn FormData into API payloads with the right types. */

export function text(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

/** Empty optional text becomes null (clears the value). */
export function optionalText(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value === '' ? null : value;
}

export function int(form: FormData, name: string): number {
  return Number.parseInt(text(form, name), 10);
}

export function checked(form: FormData, name: string): boolean {
  return form.get(name) === 'on';
}

/** Digits after the decimal point for a currency (INR 2, JPY 0, …). */
export function currencyDecimals(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** "6500.50" INR → 650050 minor units; empty → null. */
export function moneyToMinor(value: string, currency: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return Number.NaN;
  return Math.round(amount * 10 ** currencyDecimals(currency));
}

export function minorToMoney(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 10 ** currencyDecimals(currency)).toFixed(currencyDecimals(currency));
}

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(
    minor / 10 ** currencyDecimals(currency),
  );
}
