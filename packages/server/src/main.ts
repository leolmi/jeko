/**
 * Servizio di Jeko: un solo file (`jeko.js` nel bundle) per tutto.
 *
 *   node jeko.js            servizio (API, web-app, runner) su 127.0.0.1:4310
 *   node jeko.js --desktop  come estensione Neutralino: si stacca dalla finestra e prosegue
 *                           come servizio desktop, che si chiude da solo quando non serve più
 *   node jeko.js mcp        server MCP dei permessi (lo lancia claude, uno per turno)
 *   node jeko.js hook       hook PreToolUse dei permessi (lo lancia claude)
 */
import { readFileSync } from 'node:fs';

const command = process.argv[2];

if (command === 'mcp') {
  const { startMcpStdio } = await import('../../runner/src/mcp.js');
  await startMcpStdio();
} else if (command === 'hook') {
  const { runHook } = await import('../../runner/src/permissions/hook.js');
  process.stdout.write(runHook(readFileSync(0, 'utf8'), process.env));
} else if (command === '--desktop') {
  const { launchDesktop } = await import('./service.js');
  await launchDesktop();
} else {
  const { runService } = await import('./service.js');
  await runService({ desktop: process.env['JEKO_NL'] !== undefined });
}
