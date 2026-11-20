import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { Static, TSchema } from '@sinclair/typebox';

// ajv-formats è CommonJS: con NodeNext l'export di default può arrivare annidato.
const addFormats = addFormatsModule.default ?? addFormatsModule;

export const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);

const cache = new WeakMap<TSchema, ValidateFunction>();

export function validator<T extends TSchema>(schema: T): ValidateFunction<Static<T>> {
  let fn = cache.get(schema);
  if (!fn) {
    fn = ajv.compile(schema);
    cache.set(schema, fn);
  }
  return fn as ValidateFunction<Static<T>>;
}

export function assertValid<T extends TSchema>(schema: T, value: unknown): Static<T> {
  const validate = validator(schema);
  if (!validate(value)) {
    throw new Error(`Dati non validi: ${ajv.errorsText(validate.errors)}`);
  }
  return value;
}
