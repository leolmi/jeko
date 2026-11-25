// Immagine dei workflow di Jeko (docs/jeko-workflow.png) con i dati finti di demo.mjs.
// Uso: node scripts/video/workflow.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PORT, prepare } from './demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', 'docs', 'jeko-workflow.png');

const server = await prepare();
process.on('exit', () => server.kill());

console.info('dati pronti, apro Edge');
const browser = await chromium.launch({ channel: 'msedge', timeout: 60000 });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    locale: 'it-IT',
  });
  await page.goto(`http://127.0.0.1:${PORT}/workflow`);
  await page.getByText('sviluppo-completo', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: target });
  console.info(`immagine: ${target}`);
} finally {
  await browser.close();
  server.kill();
  process.exit(0);
}
