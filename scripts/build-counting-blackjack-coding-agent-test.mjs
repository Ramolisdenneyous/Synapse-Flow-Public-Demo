import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCountingBlackjackHarness } from './build-counting-blackjack-harness.mjs';

export function createCountingBlackjackCodingAgentTestHarness() {
  const harness = structuredClone(createCountingBlackjackHarness());
  harness.name = 'Four Agent Counting Blackjack - Coding Agent Test';

  const router = harness.nodes.find(
    (node) => node.id === 'four-agent-blackjack-table-engine',
  );
  router.data.description =
    'Blank Table Engine ready for Codex to build from the complete Routing intent.';
  router.data.config.generatedCode = '';
  router.data.config.generatedSummary = '';
  router.data.config.generatedAt = null;
  router.data.config.generatedJobId = null;

  return harness;
}

export async function writeCountingBlackjackCodingAgentTestHarness(outputPath) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(
    resolved,
    `${JSON.stringify(createCountingBlackjackCodingAgentTestHarness(), null, 2)}\n`,
    'utf8',
  );
  return resolved;
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const output = path.resolve(
    here,
    '..',
    'examples',
    'four-agent-counting-blackjack-coding-agent-test.synapse.json',
  );
  await writeCountingBlackjackCodingAgentTestHarness(output);
  console.log(output);
}
