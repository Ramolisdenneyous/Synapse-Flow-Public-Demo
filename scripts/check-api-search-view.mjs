import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.SYNAPSE_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const harness = JSON.parse(await readFile('examples/api-search-live-web-demo.synapse.json', 'utf8'));
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

  const searchNode = page.getByText('Live Web Search', { exact: true }).first();
  await searchNode.click();
  const providerSelect = page.getByLabel('Search provider');
  const provider = await providerSelect.inputValue();
  const rawMode = page.getByRole('button', { name: 'Raw Search', exact: true });
  const assistedMode = page.getByRole('button', { name: 'Assisted Search', exact: true });
  await rawMode.click();
  const rawSelected = await rawMode.evaluate((button) => button.classList.contains('is-active'));
  await assistedMode.click();
  const assistedSelected = await assistedMode.evaluate((button) => button.classList.contains('is-active'));

  await page.getByRole('button', { name: 'Run all' }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: 'Run all' }).waitFor({ state: 'visible', timeout: 120_000 });
  await searchNode.click();
  const sources = await page.locator('.search-source-list a').count();
  const resultText = await page.locator('.search-output-viewer pre').textContent();
  await page.screenshot({ path: 'outputs/api-search-demo.png', fullPage: true });

  const result = {
    provider,
    rawSelected,
    assistedSelected,
    sources,
    resultTextLength: resultText?.length || 0,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    provider !== 'web' ||
    !rawSelected ||
    !assistedSelected ||
    sources < 1 ||
    !resultText?.trim() ||
    errors.length
  ) process.exitCode = 1;
} finally {
  await browser.close();
}
