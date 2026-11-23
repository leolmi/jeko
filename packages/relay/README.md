# Relay di Jeko

Ponte tra Jeko e i dispositivi remoti. Smista messaggi cifrati (AES-GCM, chiave solo nel QR) e tiene in memoria l'ultimo stato di ogni dispositivo.

```sh
npm install --omit=dev
PORT=8787 RELAY_SECRET=… node src/main.ts   # Node >= 22.18
```

- Va esposto in **HTTPS** (la cifratura nel browser lo richiede; `localhost` va bene per le prove).
- `RELAY_SECRET` (facoltativo): senza, chiunque può aprire un canale nuovo; i canali esistenti restano comunque di chi li ha aperti.
- Dati: `RELAY_DATA` (predefinito `./data`), solo `channels.json` con gli hash dei token.

In Jeko: Opzioni → Accesso remoto → indirizzo del relay, Attivo, Collega un dispositivo.

## Relay su questo PC

Con «Relay su questo PC» Jeko avvia il relay da sé su `127.0.0.1:8787` (dati in `<dati di Jeko>/relay`, segreto generato da Jeko). Va reso raggiungibile in HTTPS all'indirizzo indicato nelle opzioni, per esempio con Tailscale Funnel:

```sh
tailscale funnel --bg 8787
```
