/* global addEventListener, document */
// Video dimostrativo di Jeko (docs/jeko-demo.webm): rifà i dati finti (demo.mjs), poi Edge,
// pilotato da Playwright, avvia un task, approva i gate e passa da Note, Workflow e Statistiche.
// Uso: node scripts/video/record.mjs
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demo, PORT, prepare } from './demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', 'docs', 'jeko-demo.webm');
const size = { width: 1280, height: 760 };
const REQUEST = "Aggiungi la ricerca per ingrediente nell'elenco delle ricette";

// Cursore disegnato nella pagina: il video di Playwright non mostra quello vero.
const CURSOR = () => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText =
      'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(255,255,255,.35);border:2px solid #fff;pointer-events:none;' +
      'transition:transform .15s;left:-50px;top:-50px;box-shadow:0 0 6px rgba(0,0,0,.6)';
    document.body.appendChild(c);
    addEventListener(
      'mousemove',
      (e) => {
        c.style.left = `${e.clientX}px`;
        c.style.top = `${e.clientY}px`;
      },
      true,
    );
    addEventListener('mousedown', () => (c.style.transform = 'scale(.7)'), true);
    addEventListener('mouseup', () => (c.style.transform = ''), true);
  });
};

const server = await prepare();
process.on('exit', () => server.kill());
const videos = join(demo, 'video');
rmSync(videos, { recursive: true, force: true });
mkdirSync(videos, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({
  viewport: size,
  colorScheme: 'dark',
  locale: 'it-IT',
  recordVideo: { dir: videos, size },
});
await context.addInitScript(CURSOR);
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

/** Porta il cursore sull'elemento con un movimento visibile, poi clicca. */
async function click(locator) {
  await locator.waitFor({ state: 'visible', timeout: 60000 });
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await pause(250);
  await locator.click();
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('textbox', { name: 'Richiesta' }).waitFor();
  await page.mouse.move(640, 380);
  await pause(1500);

  // I progetti e il loro storico.
  await click(page.getByText('meteo-cli', { exact: true }));
  await pause(1500);
  await click(page.getByText('ricettario', { exact: true }));
  await pause(800);
  await click(page.getByRole('button', { name: /Mostra chiusi/ }));
  await pause(2500);

  // Un task nuovo, in modalità checkpoint.
  await click(page.getByRole('textbox', { name: 'Richiesta' }));
  await page.keyboard.type(REQUEST, { delay: 35 });
  await pause(600);
  await click(page.getByRole('button', { name: 'Avvia' }));

  // Gate del piano, poi quello delle modifiche.
  for (const wait of [3500, 3000]) {
    const approve = page.getByRole('button', { name: 'Approva' });
    await approve.waitFor({ state: 'visible', timeout: 120000 });
    await pause(wait);
    await click(approve);
  }
  await pause(4000);

  // Le pagine dalla barra a sinistra.
  await click(page.getByRole('link', { name: 'Note', exact: true }));
  await pause(3000);
  await click(page.getByRole('link', { name: 'Workflow', exact: true }));
  await pause(3500);
  await click(page.getByRole('link', { name: 'Statistiche', exact: true }));
  await pause(4500);
  await click(page.getByRole('link', { name: /^Progetti/ }));
  await pause(2000);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  server.kill();
  if (video) {
    copyFileSync(await video.path(), target);
    console.info(`video: ${target}`);
  }
}
