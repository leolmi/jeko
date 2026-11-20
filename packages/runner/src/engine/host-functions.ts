import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { ExprError, type Fn, type HostFunction, type Value } from '@jeko/shared';

function pathArg(name: string, v: Value | undefined): string {
  if (typeof v !== 'string' || !v) throw new ExprError(`${name}() vuole un percorso`, -1);
  return v;
}

/** Funzioni del mini-linguaggio che leggono il file system (solo lettura). */
export const hostFunctions: Readonly<Record<HostFunction, Fn>> = {
  exists: (p) => existsSync(pathArg('exists', p)),
  isDir: (p) => {
    const f = pathArg('isDir', p);
    return existsSync(f) && statSync(f).isDirectory();
  },
  isEmptyDir: (p) => {
    const f = pathArg('isEmptyDir', p);
    return existsSync(f) && statSync(f).isDirectory() && readdirSync(f).length === 0;
  },
  fileContains: (p, text) => {
    const f = pathArg('fileContains', p);
    if (typeof text !== 'string') throw new ExprError('fileContains() vuole un testo', -1);
    return existsSync(f) && statSync(f).isFile() && readFileSync(f, 'utf8').includes(text);
  },
};
