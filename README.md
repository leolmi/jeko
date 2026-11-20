# Jeko

Tool di SDLC locale e personale.

## Pacchetti

| Pacchetto         | Contenuto                                                         |
| ----------------- | ----------------------------------------------------------------- |
| `packages/shared` | Contratto e validazione (TypeBox + Ajv)                           |
| `packages/server` | API Fastify 5 (websocket, rate-limit), Postgres con `pg`          |
| `packages/runner` | Client WebSocket, server MCP, lancia `claude` una volta per turno |
| `packages/admin`  | App web Angular 22 zoneless, Tailwind 4, Lato e IBM Plex Mono     |

## Requisiti

Node ≥ 22, Postgres (per i test basta PGlite).

## Comandi

```sh
npm install
npm run build          # shared → server → runner → admin
npm test               # Vitest (shared, server, runner) + test di admin
npm run lint
npm run format
npm run dev:server     # http://127.0.0.1:4310
npm run dev:runner
npm run dev:admin      # http://localhost:4200, /api in proxy sul server
```

Variabili d'ambiente: vedi `.env.example`.
