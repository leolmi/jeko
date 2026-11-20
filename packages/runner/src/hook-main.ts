import { readFileSync } from 'node:fs';
import { runHook } from './permissions/hook.js';

process.stdout.write(runHook(readFileSync(0, 'utf8'), process.env));
