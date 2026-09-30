import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const INPUT_USD_PER_TOKEN = 2 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 12 / 1_000_000;

export class DemoBudget {
  constructor({ directory, limitUsd }) {
    this.directory = directory;
    this.limitUsd = limitUsd;
    this.path = path.join(directory, 'demo-budget.json');
    this.state = { spentUsd: 0, reservedUsd: 0, updatedAt: null };
    this.loaded = false;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await mkdir(this.directory, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      this.state = { ...this.state, ...saved, reservedUsd: 0 };
    } catch {
      // First boot starts with a clean, intentionally tiny demo allowance.
    }
    this.loaded = true;
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

  async reserve(estimateUsd) {
    const work = async () => {
      await this.load();
      if (this.state.spentUsd + this.state.reservedUsd + estimateUsd > this.limitUsd) {
        throw new Error('The Public Demo AI budget is exhausted. Please try again after the demo budget is reset.');
      }
      this.state.reservedUsd += estimateUsd;
      await this.persist();
      return estimateUsd;
    };
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  async settle(reservationUsd, usage = {}) {
    const work = async () => {
      await this.load();
      const input = Number(usage.input_tokens || 0);
      const output = Number(usage.output_tokens || 0);
      const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
      const actual = Math.max(0, (input - cached) * INPUT_USD_PER_TOKEN + cached * (0.2 / 1_000_000) + output * OUTPUT_USD_PER_TOKEN);
      this.state.reservedUsd = Math.max(0, this.state.reservedUsd - reservationUsd);
      this.state.spentUsd += actual || reservationUsd;
      await this.persist();
      return this.snapshot();
    };
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  async release(reservationUsd) {
    const work = async () => {
      await this.load();
      this.state.reservedUsd = Math.max(0, this.state.reservedUsd - reservationUsd);
      await this.persist();
    };
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  snapshot() {
    return {
      limitUsd: this.limitUsd,
      spentUsd: Number(this.state.spentUsd.toFixed(4)),
      remainingUsd: Number(Math.max(0, this.limitUsd - this.state.spentUsd - this.state.reservedUsd).toFixed(4)),
      locked: this.state.spentUsd + this.state.reservedUsd >= this.limitUsd,
    };
  }
}
