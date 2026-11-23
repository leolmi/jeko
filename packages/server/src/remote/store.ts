import { join } from 'node:path';
import { readJson, writeJson } from '../data/files.js';
import { newId, newKey } from './seal.js';

/** Quanto vale un link di collegamento: entro questo tempo va aperto e confermato sul PC. */
export const PAIRING_TTL_MS = 15 * 60_000;

export interface RemoteDevice {
  id: string;
  /** Chiave AES del dispositivo (base64url): è nel QR e solo qui. */
  key: string;
  /** Nome dato dal dispositivo al primo collegamento. */
  name: string | null;
  createdAt: string;
  /** Confermato sul PC: solo allora vede i dati e può fare richieste. */
  confirmed: boolean;
  seenAt: string | null;
}

interface RemoteFile {
  enabled: boolean;
  relayUrl: string;
  /** Canale sul relay e token che lo apre: si generano una volta. */
  channel: string;
  token: string;
  devices: RemoteDevice[];
}

/** Dispositivo come lo vede la pagina admin: senza chiave. */
export type PublicDevice = Omit<RemoteDevice, 'key'> & { expiresAt: string | null };

/** Accesso remoto: relay, canale e dispositivi collegati (`remote.json`). */
export class RemoteStore {
  private readonly file: string;
  private data: RemoteFile;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'remote.json');
    this.data = readJson<RemoteFile>(this.file, {
      enabled: false,
      relayUrl: '',
      channel: newId(),
      token: newId(32),
      devices: [],
    });
  }

  get enabled(): boolean {
    return this.data.enabled && this.data.relayUrl !== '';
  }
  get relayUrl(): string {
    return this.data.relayUrl;
  }
  get channel(): string {
    return this.data.channel;
  }
  get token(): string {
    return this.data.token;
  }

  configure(enabled: boolean, relayUrl: string): void {
    this.data = { ...this.data, enabled, relayUrl: relayUrl.trim().replace(/\/+$/, '') };
    this.save();
  }

  /** Dispositivi validi: i non confermati scadono dopo `PAIRING_TTL_MS`. */
  devices(now = Date.now()): RemoteDevice[] {
    const alive = this.data.devices.filter((d) => d.confirmed || !expired(d, now));
    if (alive.length !== this.data.devices.length) {
      this.data = { ...this.data, devices: alive };
      this.save();
    }
    return alive;
  }

  device(id: string): RemoteDevice | undefined {
    return this.devices().find((d) => d.id === id);
  }

  publicDevices(): PublicDevice[] {
    return this.devices().map(({ key: _, ...d }) => ({
      ...d,
      expiresAt: d.confirmed
        ? null
        : new Date(Date.parse(d.createdAt) + PAIRING_TTL_MS).toISOString(),
    }));
  }

  pair(): RemoteDevice {
    const device: RemoteDevice = {
      id: newId(),
      key: newKey(),
      name: null,
      createdAt: new Date().toISOString(),
      confirmed: false,
      seenAt: null,
    };
    this.data = { ...this.data, devices: [...this.devices(), device] };
    this.save();
    return device;
  }

  update(id: string, patch: Partial<Pick<RemoteDevice, 'name' | 'confirmed' | 'seenAt'>>): boolean {
    if (!this.device(id)) return false;
    this.data = {
      ...this.data,
      devices: this.data.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    };
    this.save();
    return true;
  }

  remove(id: string): boolean {
    const before = this.data.devices.length;
    this.data = { ...this.data, devices: this.data.devices.filter((d) => d.id !== id) };
    this.save();
    return this.data.devices.length < before;
  }

  /** Link del QR: la chiave sta dopo `#`, che il browser non manda al relay. */
  link(device: RemoteDevice): string {
    const q = new URLSearchParams({ c: this.data.channel, d: device.id, k: device.key });
    return `${this.data.relayUrl}/#${q.toString()}`;
  }

  private save(): void {
    writeJson(this.file, this.data);
  }
}

function expired(d: RemoteDevice, now: number): boolean {
  return now - Date.parse(d.createdAt) > PAIRING_TTL_MS;
}
