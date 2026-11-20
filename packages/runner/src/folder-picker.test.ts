import { describe, expect, it } from 'vitest';
import { encodeCommand, PICKER_SCRIPT } from './folder-picker.js';
import { run } from './spawn.js';

describe('dialogo della cartella', () => {
  // Compila il codice del dialogo senza aprirlo: tutto lo script fino alla finestra proprietaria.
  it.runIf(process.platform === 'win32')(
    'lo script compila su Windows',
    async () => {
      const compileOnly =
        PICKER_SCRIPT.slice(0, PICKER_SCRIPT.indexOf('$owner =')) +
        '[Console]::Out.Write([JekoFolderPicker].FullName)';
      const res = await run(
        [
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-EncodedCommand',
          encodeCommand(compileOnly),
        ],
        { windowsHide: true },
      );
      expect(res.stderr).toBe('');
      expect(res.stdout).toBe('JekoFolderPicker');
    },
    30_000,
  );
});
