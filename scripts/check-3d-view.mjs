import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const baseUrl = process.env.SYNAPSE_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const canvas = page.locator('canvas.graph-3d-canvas');
  await canvas.waitFor({ state: 'visible' });
  await page.waitForTimeout(600);

  const desktopBox = await canvas.boundingBox();
  const desktopCanvasImage = PNG.sync.read(await canvas.screenshot());
  const desktopPixels = (() => {
    const { data: pixels, width, height } = desktopCanvasImage;
    let nonBlack = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 20 || pixels[index + 1] > 20 || pixels[index + 2] > 20) nonBlack += 1;
    }
    return { nonBlack, width, height };
  })();

  await canvas.click({ position: {
    x: desktopBox.width * 0.463,
    y: desktopBox.height * 0.45,
  } });
  await page.waitForTimeout(150);
  const selectionWorks = await page.locator('.empty-inspector').count() === 0;

  await page.getByRole('button', { name: '2D', exact: true }).click();
  const twoDVisible = await page.locator('.react-flow').isVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await canvas.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'outputs/graph-3d-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobileButtonVisible = await page.getByRole('button', { name: '3D', exact: true }).isVisible();
  const mobileBox = await canvas.boundingBox();
  await page.screenshot({ path: 'outputs/graph-3d-mobile.png', fullPage: true });

  const result = {
    desktopBox,
    desktopPixels,
    selectionWorks,
    twoDVisible,
    mobileButtonVisible,
    mobileBox,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    !desktopBox ||
    desktopPixels.nonBlack === 0 ||
    !selectionWorks ||
    !twoDVisible ||
    !mobileButtonVisible ||
    !mobileBox ||
    errors.length
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
