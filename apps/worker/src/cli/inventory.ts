import { parseArgs } from 'node:util';
import {
  createDbClient,
  inventoryTargets,
  repairInventory,
  runReconciliation,
  type InventoryMismatch,
} from '@staydesk/db';
import { loadWorkerEnv } from '../env.js';

/**
 * Operator commands for the inventory projection (docs/08 §12):
 *
 *   inventory reconcile [--property <id>] [--actor <name>]
 *       Checks one or every property and records a MANUAL run. Changes nothing.
 *
 *   inventory repair --property <id> --actor <name> --reason "<why>"
 *       Rebuilds one property's counters from bookings and blocks, under the normal locks,
 *       after a mismatch has been investigated. Recorded and audited.
 */

const USAGE = `Usage:
  inventory reconcile [--property <id>] [--actor <name>]
  inventory repair --property <id> --actor <name> --reason "<why>"`;

function print(mismatches: InventoryMismatch[]): void {
  for (const m of mismatches.slice(0, 20)) {
    process.stdout.write(
      `  ${m.kind.padEnd(8)} ${m.roomTypeId} ${m.date} expected ${JSON.stringify(m.expected)} actual ${JSON.stringify(m.actual)}\n`,
    );
  }
  if (mismatches.length > 20) process.stdout.write(`  … and ${mismatches.length - 20} more\n`);
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      property: { type: 'string' },
      actor: { type: 'string' },
      reason: { type: 'string' },
    },
  });
  const command = positionals[0];
  if (command !== 'reconcile' && command !== 'repair') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const env = loadWorkerEnv();
  const db = createDbClient({
    connectionString: env.WORKER_DATABASE_URL,
    applicationName: 'staydesk-inventory-cli',
    max: 2,
  });
  try {
    const all = await inventoryTargets(db);
    const targets = values.property ? all.filter((t) => t.propertyId === values.property) : all;
    if (values.property && targets.length === 0) {
      process.stderr.write(`No active property ${values.property}\n`);
      return 1;
    }

    if (command === 'reconcile') {
      let incidents = 0;
      for (const target of targets) {
        const run = await runReconciliation(db, target, {
          trigger: 'MANUAL',
          actor: values.actor ?? 'cli',
        });
        process.stdout.write(
          `${target.propertyId}: ${run.mismatchCount === 0 ? 'clean' : `${run.mismatchCount} mismatch(es)`} (run ${run.id})\n`,
        );
        if (run.mismatchCount > 0) {
          incidents++;
          print(run.mismatches);
        }
      }
      return incidents > 0 ? 1 : 0;
    }

    if (!values.property || !values.actor || !values.reason) {
      process.stderr.write(`repair needs --property, --actor and --reason\n${USAGE}\n`);
      return 2;
    }
    const result = await repairInventory(db, targets[0]!, {
      actor: values.actor,
      reason: values.reason,
    });
    process.stdout.write(
      `Repaired ${values.property}: ${result.before.mismatchCount} mismatch(es) fixed, ${result.rowsChanged} row(s) changed; now clean.\n`,
    );
    print(result.before.mismatches);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
