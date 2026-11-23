# Relay di Jeko

Ponte tra Jeko e i dispositivi remoti. Smista messaggi cifrati (AES-GCM, chiave solo nel QR) e tiene in memoria l'ultimo stato di ogni dispositivo.

```sh
npm install --omit=dev
PORT=8787 RELAY_SECRET=… node src/relay.ts   # Node >= 22.18
```

- Va esposto in **HTTPS** (la cifratura nel browser lo richiede; `localhost` va bene per le prove).
- `RELAY_SECRET` (facoltativo): senza, chiunque può aprire un canale nuovo; i canali esistenti restano comunque di chi li ha aperti.
- Dati: `RELAY_DATA` (predefinito `./data`), solo `channels.json` con gli hash dei token.

In Jeko: Opzioni → Accesso remoto → indirizzo del relay, Attivo, Collega un dispositivo.
