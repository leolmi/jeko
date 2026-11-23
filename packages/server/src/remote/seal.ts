/**
 * Cifratura dei messaggi tra Jeko e un dispositivo remoto (AES-256-GCM, WebCrypto).
 * Il relay vede solo testo cifrato: la chiave sta nel QR, nella parte dopo `#` del link,
 * che il browser non manda mai al server.
 *
 * Formato: base64url(iv[12] ‖ testo cifrato ‖ tag). Il dato aggiuntivo autenticato lega il
 * messaggio al dispositivo e alla direzione, così non si può rimandarlo indietro o a un altro.
 * Il testo in chiaro è `{ ts, b }`: `ts` serve contro i messaggi rimandati.
 *
 * Copia in JavaScript per la pagina remota: `packages/relay/public/seal.js` (i test le
 * confrontano).
 */
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

/** `c2h` dispositivo → Jeko, `h2c` Jeko → dispositivo. */
export type Direction = 'c2h' | 'h2c';

export interface Opened<T = unknown> {
  ts: number;
  body: T;
}

export function newKey(): string {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export function newId(bytes = 16): string {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

export async function importKey(key: string): Promise<webcrypto.CryptoKey> {
  const raw = Buffer.from(key, 'base64url');
  if (raw.length !== 32) throw new Error('Chiave non valida');
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const aad = (dir: Direction, device: string) => Buffer.from(`jeko-remote/1|${dir}|${device}`);

export async function seal(
  key: webcrypto.CryptoKey,
  dir: Direction,
  device: string,
  body: unknown,
  ts = Date.now(),
): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const plain = Buffer.from(JSON.stringify({ ts, b: body }));
  const sealed = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(dir, device) },
    key,
    plain,
  );
  return Buffer.concat([iv, Buffer.from(sealed)]).toString('base64url');
}

/** null se il messaggio non è di questa chiave, dispositivo e direzione (o è rovinato). */
export async function open<T = unknown>(
  key: webcrypto.CryptoKey,
  dir: Direction,
  device: string,
  data: string,
): Promise<Opened<T> | null> {
  try {
    const raw = Buffer.from(data, 'base64url');
    if (raw.length < 12 + 16) return null;
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: aad(dir, device) },
      key,
      raw.subarray(12),
    );
    const parsed = JSON.parse(Buffer.from(plain).toString('utf8')) as { ts?: unknown; b?: unknown };
    if (typeof parsed.ts !== 'number') return null;
    return { ts: parsed.ts, body: parsed.b as T };
  } catch {
    return null;
  }
}
