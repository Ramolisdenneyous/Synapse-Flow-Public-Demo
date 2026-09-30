import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.SYNAPSE_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const harness = JSON.parse(await readFile('examples/mage-rpg-local-rag-demo.synapse.json', 'utf8'));
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text());
  });
  await page.addInitScript((project) => {
    localStorage.setItem('synapse-flow:mvp', JSON.stringify(project));
  }, harness);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  const ragNode = page.getByText('Mage Rules RAG', { exact: true }).first();
  await ragNode.click();
  const provider = await page.getByLabel('Search provider').inputValue();
  const indexPath = await page.getByLabel('Local RAG index file').inputValue();
  const rawMode = page.getByRole('button', { name: 'Raw Retrieval', exact: true });
  const assistedMode = page.getByRole('button', { name: 'Assisted Retrieval', exact: true });
  await rawMode.click();
  const rawSelected = await rawMode.evaluate((button) => button.classList.contains('is-active'));
  await assistedMode.click();
  const assistedSelected = await assistedMode.evaluate((button) => button.classList.contains('is-active'));

  await page.getByRole('button', { name: 'Run all' }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: 'Run all' }).waitFor({ state: 'visible', timeout: 60_000 });
  await ragNode.click();
  const resultCards = await page.locator('.search-source-record').count();
  const resultText = await page.locator('.search-output-viewer pre').textContent();
  await page.screenshot({ path: 'outputs/mage-local-rag-demo.png', fullPage: true });

  const result = {
    provider,
    indexBound: indexPath.endsWith('Mage-RPG-Rules.synapse-rag.sqlite'),
    rawSelected,
    assistedSelected,
    resultCards,
    resultTextLength: resultText?.length || 0,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    provider !== 'localrag' ||
    !result.indexBound ||
    !rawSelected ||
    !assistedSelected ||
    resultCards < 1 ||
    !resultText?.trim() ||
    errors.length
  ) process.exitCode = 1;
} finally {
  await browser.close();
}
