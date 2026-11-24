// Archivio .tar.gz (formato ustar) scritto in Node: da Windows non si possono dare ai file i
// permessi di Linux e macOS, qui sì (l'eseguibile e gli script con 0755).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

/**
 * Voci dell'archivio da una cartella o da un file: `[percorso nell'archivio, sorgente, modo?]`.
 * Il modo vale per i file; le cartelle sono 0755, gli altri file 0644.
 */
export function collect(items) {
  const out = [];
  const add = (name, src, mode) => {
    if (statSync(src).isDirectory()) {
      out.push({ name: `${name}/`, dir: true, mode: 0o755 });
      for (const e of readdirSync(src).sort()) add(`${name}/${e}`, join(src, e), undefined);
    } else {
      out.push({ name, data: readFileSync(src), mode: mode ?? 0o644 });
    }
  };
  for (const [name, src, mode] of items) add(name, src, mode);
  return out;
}

/** `entries`: `{ name, mode, dir?, data? }`, con `/` come separatore. */
export function tarGz(entries, mtime = Math.floor(Date.now() / 1000)) {
  const blocks = [];
  for (const e of entries) {
    const data = e.dir ? Buffer.alloc(0) : e.data;
    blocks.push(header(e.name, e.mode, data.length, mtime, e.dir ? '5' : '0'));
    if (data.length) {
      blocks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

function header(path, mode, size, mtime, type) {
  const h = Buffer.alloc(512);
  const [prefix, name] = split(path);
  const str = (v, off, len) => h.write(v, off, len, 'utf8');
  const oct = (v, off, len) => str(`${v.toString(8).padStart(len - 1, '0')}\0`, off, len);
  str(name, 0, 100);
  oct(mode, 100, 8);
  oct(0, 108, 8); // uid
  oct(0, 116, 8); // gid
  oct(size, 124, 12);
  oct(mtime, 136, 12);
  h.fill(' ', 148, 156); // checksum, per ora spazi
  str(type, 156, 1);
  str('ustar\0', 257, 6);
  str('00', 263, 2);
  str(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  str(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return h;
}

/** Nomi oltre i 100 byte: la parte iniziale va in `prefix` (fino a 155), divisa su un `/`. */
function split(path) {
  if (Buffer.byteLength(path) <= 100) return ['', path];
  for (let i = path.indexOf('/'); i > 0; i = path.indexOf('/', i + 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100 && name)
      return [prefix, name];
  }
  throw new Error(`nome troppo lungo per l'archivio: ${path}`);
}
