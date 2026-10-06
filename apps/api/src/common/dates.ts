import { LocalDate } from '@staydesk/domain';

/** SQL DATE columns arrive from Prisma as Dates at UTC midnight; convert at the boundary. */
export function dateColumn(date: LocalDate | string): Date {
  return new Date(`${date.toString()}T00:00:00.000Z`);
}

export function localDateOf(column: Date): LocalDate {
  return LocalDate.parse(column.toISOString().slice(0, 10));
}

export function isoDateOf(column: Date): string {
  return column.toISOString().slice(0, 10);
}
