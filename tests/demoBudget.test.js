import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DemoBudget, resolveDemoClientId } from '../server/demoBudget.js';

async function withBudget(test) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'synapse-flow-budget-'));
  try {
    await test(new DemoBudget({ directory, limitUsd: 1 }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('per-browser demo budget', () => {
  it('isolates spending and reset between browser client IDs', async () => {
    await withBudget(async (budget) => {
      const clientA = crypto.randomUUID();
      const clientB = crypto.randomUUID();
      const reservation = await budget.reserve(clientA, 0.4);
      await budget.settle(clientA, reservation, {});

      expect(budget.snapshot(clientA).remainingUsd).toBeCloseTo(0.6);
      expect(budget.snapshot(clientB).remainingUsd).toBe(1);

      await budget.reset(clientA);
      expect(budget.snapshot(clientA).remainingUsd).toBe(1);
      expect(budget.snapshot(clientB).remainingUsd).toBe(1);
    });
  });

  it('serializes simultaneous reservations for one browser', async () => {
    await withBudget(async (budget) => {
      const clientId = crypto.randomUUID();
      const results = await Promise.allSettled([
        budget.reserve(clientId, 0.7),
        budget.reserve(clientId, 0.7),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });
  });

  it('does not accept malformed or missing IDs as a shared budget bucket', () => {
    const malformed = resolveDemoClientId('not-a-uuid');
    const missing = resolveDemoClientId();
    expect(malformed.generated).toBe(true);
    expect(missing.generated).toBe(true);
    expect(malformed.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(missing.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(malformed.clientId).not.toBe(missing.clientId);
  });
});
