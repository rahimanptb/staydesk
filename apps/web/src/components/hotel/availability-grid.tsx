import type {
  AvailabilityGrid,
  AvailabilityNight,
  AvailabilityStatusValue,
} from '@staydesk/contracts';
import { formatDate, formatMonth, formatWeekday, isWeekend } from '../../lib/dates';

/** One meaning per colour, everywhere availability is shown (docs/07 §1). */
export const AVAILABILITY_STYLE: Record<
  AvailabilityStatusValue,
  { label: string; cell: string; swatch: string }
> = {
  AVAILABLE: {
    label: 'Available',
    cell: 'bg-status-available/10 text-status-available',
    swatch: 'bg-status-available/30',
  },
  LOW: { label: 'Low', cell: 'bg-status-low/15 text-status-low', swatch: 'bg-status-low/40' },
  BLOCKED: {
    label: 'Blocked',
    cell: 'bg-status-blocked/15 text-status-blocked',
    swatch: 'bg-status-blocked/40',
  },
  FULL: { label: 'Full', cell: 'bg-status-full/15 text-status-full', swatch: 'bg-status-full/40' },
  OVERBOOKED: {
    label: 'Overbooked',
    cell: 'bg-status-full text-white',
    swatch: 'bg-status-full',
  },
  CLOSED: { label: 'Closed', cell: 'bg-status-closed text-white', swatch: 'bg-status-closed' },
};

export function describeNight(n: AvailabilityNight): string {
  const parts = [
    `${formatDate(n.date)}: ${AVAILABILITY_STYLE[n.status].label}`,
    `${n.available} of ${n.total} available`,
    `${n.booked} booked`,
    `${n.held} held`,
    `${n.blocked} blocked`,
    `${n.outOfService} out of service`,
  ];
  if (n.closedAll) parts.push('closed for sale');
  else if (n.closedAgents) parts.push('closed to travel agents');
  return parts.join(' · ');
}

function monthSpans(dates: string[]): Array<{ month: string; span: number }> {
  const spans: Array<{ month: string; span: number }> = [];
  for (const d of dates) {
    const month = formatMonth(d);
    const last = spans.at(-1);
    if (last?.month === month) last.span++;
    else spans.push({ month, span: 1 });
  }
  return spans;
}

/** Room types × nights; each cell shows rooms still available (docs/07 §4.3). */
export function AvailabilityGridView({ grid }: { grid: AvailabilityGrid }) {
  const dates = grid.roomTypes[0]?.nights.map((n) => n.date) ?? [];
  const sticky = 'sticky left-0 z-10 bg-[var(--surface-raised)]';
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          Rooms available per night, from {formatDate(grid.from)}
        </caption>
        <thead className="text-xs text-[var(--text-muted)]">
          <tr>
            <th
              scope="col"
              rowSpan={2}
              className={`${sticky} min-w-44 border-b border-[var(--border)] px-4 py-2 text-left font-medium`}
            >
              Room type
            </th>
            {monthSpans(dates).map((m) => (
              <th
                key={m.month}
                scope="colgroup"
                colSpan={m.span}
                className="border-l border-[var(--border)] px-2 pt-2 text-left font-medium"
              >
                {m.month}
              </th>
            ))}
          </tr>
          <tr>
            {dates.map((d) => {
              const today = d === grid.businessDate;
              return (
                <th
                  key={d}
                  scope="col"
                  aria-label={formatDate(d)}
                  className={`min-w-11 border-b border-[var(--border)] px-1 pb-2 pt-1 text-center font-medium ${
                    isWeekend(d) ? 'bg-[var(--surface)]' : ''
                  } ${today ? 'text-brand-600' : ''}`}
                >
                  <div>{formatWeekday(d)}</div>
                  <div className={`text-sm ${today ? 'font-semibold' : 'text-[var(--text)]'}`}>
                    {Number(d.slice(8))}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grid.roomTypes.map((rt) => (
            <tr key={rt.roomTypeId}>
              <th
                scope="row"
                className={`${sticky} border-b border-[var(--border)] px-4 py-2 text-left font-medium`}
              >
                <div>{rt.name}</div>
                <div className="text-xs font-normal text-[var(--text-muted)]">
                  {rt.code} · {rt.totalInventory} room{rt.totalInventory === 1 ? '' : 's'}
                </div>
              </th>
              {rt.nights.map((n) => {
                const style = AVAILABILITY_STYLE[n.status];
                return (
                  <td
                    key={n.date}
                    title={describeNight(n)}
                    className={`border-b border-[var(--border)] p-0.5 text-center ${
                      isWeekend(n.date) ? 'bg-[var(--surface)]' : ''
                    }`}
                  >
                    <span
                      className={`relative flex h-9 items-center justify-center rounded text-sm font-semibold tabular-nums ${style.cell} ${
                        n.date === grid.businessDate ? 'ring-2 ring-brand-600/40' : ''
                      }`}
                    >
                      <span aria-hidden="true">{n.status === 'CLOSED' ? '×' : n.available}</span>
                      {n.closedAgents && !n.closedAll ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-status-closed"
                        />
                      ) : null}
                      <span className="sr-only">{describeNight(n)}</span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AvailabilityLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-muted)]">
      {(Object.keys(AVAILABILITY_STYLE) as AvailabilityStatusValue[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-3 rounded-sm ${AVAILABILITY_STYLE[s].swatch}`}
          />
          {AVAILABILITY_STYLE[s].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-status-closed" />
        Closed to travel agents
      </li>
    </ul>
  );
}
