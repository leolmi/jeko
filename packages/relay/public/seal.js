// Cifratura dei messaggi con Jeko: copia di packages/server/src/remote/seal.ts (stesso formato).
// AES-256-GCM; dato autenticato = `jeko-remote/1|<direzione>|<dispositivo>`.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function importKey(key) {
  const raw = fromB64u(key);
  if (raw.length !== 32) throw new Error('Chiave non valida');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const aad = (dir, device) => enc.encode(`jeko-remote/1|${dir}|${device}`);

export async function seal(key, dir, device, body, ts = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(dir, device) },
    key,
    enc.encode(JSON.stringify({ ts, b: body })),
  );
  const out = new Uint8Array(12 + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), 12);
  return toB64u(out);
}

export async function open(key, dir, device, data) {
  try {
    const raw = fromB64u(data);
    if (raw.length < 28) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: aad(dir, device) },
      key,
      raw.subarray(12),
    );
    const parsed = JSON.parse(dec.decode(plain));
    if (typeof parsed.ts !== 'number') return null;
    return { ts: parsed.ts, body: parsed.b };
  } catch {
    return null;
  }
}
