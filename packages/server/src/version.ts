import { readFileSync } from 'node:fs';

declare const __JEKO_VERSION__: string | undefined;

/** Versione di Jeko: scritta nel bundle da `build.mjs`, in sviluppo dal package.json della radice. */
export const VERSION: string =
  typeof __JEKO_VERSION__ === 'string'
    ? __JEKO_VERSION__
    : (
        JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
          version: string;
        }
      ).version;
