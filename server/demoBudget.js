import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const INPUT_USD_PER_TOKEN = 2 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 12 / 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveDemoClientId(value) {
  const candidate = String(value || '').trim();
  return UUID_PATTERN.test(candidate)
    ? { clientId: candidate.toLowerCase(), generated: false }
    : { clientId: randomUUID(), generated: true };
}

export class DemoBudget {
  constructor({ directory, limitUsd }) {
    this.directory = directory;
    this.limitUsd = limitUsd;
    this.path = path.join(directory, 'demo-budget.json');
    this.state = { clients: {}, updatedAt: null };
    this.loaded = false;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await mkdir(this.directory, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      this.state = saved?.clients && typeof saved.clients === 'object'
        ? { clients: saved.clients, updatedAt: saved.updatedAt || null }
        : { clients: {}, updatedAt: null };
    } catch {
      // First boot starts with isolated, intentionally tiny demo allowances.
    }
    this.loaded = true;
  }

  entry(clientId) {
    const existing = this.state.clients[clientId];
    if (existing && typeof existing === 'object') {
      existing.spentUsd = Math.max(0, Number(existing.spentUsd) || 0);
      existing.reservedUsd = Math.max(0, Number(existing.reservedUsd) || 0);
      return existing;
    }
    const entry = { spentUsd: 0, reservedUsd: 0, updatedAt: null };
    this.state.clients[clientId] = entry;
    return entry;
  }

  async persist() {
    this.state.updatedAt = new Date().toISOString();
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.path);
  }

  estimate({ inputTokens, maxOutputTokens }) {
    return inputTokens * INPUT_USD_PER_TOKEN + maxOutputTokens * OUTPUT_USD_PER_TOKEN;
  }

  async reserve(clientId, estimateUsd) {
    const work = async () => {
      await this.load();
      const entry = this.entry(clientId);
      if (entry.spentUsd + entry.reservedUsd + estimateUsd > this.limitUsd) {
        throw new Error('This browser\'s Public Demo AI budget is exhausted. Click New to reset its demo budget.');
      }
      entry.reservedUsd += estimateUsd;
      entry.updatedAt = new Date().toISOString();
      await this.persist();
      return estimateUsd;
    };
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  async settle(clientId, reservationUsd, usage = {}) {
    const work = async () => {
      await this.load();
      const entry = this.entry(clientId);
      const input = Number(usage.input_tokens || 0);
      const output = Number(usage.output_tokens || 0);
      const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
      const actual = Math.max(0, (input - cached) * INPUT_USD_PER_TOKEN + cached * (0.2 / 1_000_000) + output * OUTPUT_USD_PER_TOKEN);
      entry.reservedUsd = Math.max(0, entry.reservedUsd - reservationUsd);
      entry.spentUsd += actual || reservationUsd;
      entry.updatedAt = new Date().toISOString();
      await this.persist();
      return this.snapshot(clientId);
    };
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  async release(clientId, reservationUsd) {
    const work = async () => {
      await this.load();
      const entry = this.entry(clientId);
      entry.reservedUsd = Math.max(0, entry.reservedUsd - reservationUsd);
      entry.updatedAt = new Date().toISOString();
      await this.persist();
    };
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  async reset(clientId) {
    const work = async () => {
      await this.load();
      this.state.clients[clientId] = { spentUsd: 0, reservedUsd: 0, updatedAt: new Date().toISOString() };
      await this.persist();
      return this.snapshot(clientId);
    };
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  snapshot(clientId) {
    const entry = this.entry(clientId);
    return {
      limitUsd: this.limitUsd,
      spentUsd: Number(entry.spentUsd.toFixed(4)),
      remainingUsd: Number(Math.max(0, this.limitUsd - entry.spentUsd - entry.reservedUsd).toFixed(4)),
      locked: entry.spentUsd + entry.reservedUsd >= this.limitUsd,
    };
  }
}
