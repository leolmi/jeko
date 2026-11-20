# Jeko

Tool di SDLC locale e personale.

## Pacchetti

| Pacchetto         | Contenuto                                                         |
| ----------------- | ----------------------------------------------------------------- |
| `packages/shared` | Contratto e validazione (TypeBox + Ajv)                           |
| `packages/server` | API Fastify 5 (websocket, rate-limit), PGlite o Postgres con `pg` |
| `packages/runner` | Client WebSocket, server MCP, lancia `claude` una volta per turno |
| `packages/admin`  | App web Angular 22 zoneless, Tailwind 4, Lato e IBM Plex Mono     |

## Requisiti

Node ≥ 22. Sul PC del runner anche Git e Claude Code. Nient'altro da installare.

## Database

Di default il server usa Postgres incorporato ([PGlite](https://pglite.dev)): i dati stanno in `%LOCALAPPDATA%\jeko\db` (o in `JEKO_DB_DIR`) e per il backup basta copiare la cartella a server fermo. Al primo avvio crea le tabelle e carica i workflow di serie.

Per un Postgres vero basta `DATABASE_URL`. [`docker-compose.yml`](docker-compose.yml) ne avvia uno con Docker Engine e Compose (gratuiti, senza Docker Desktop) o con `podman compose`:

```sh
docker compose up -d
# poi il server con DATABASE_URL=postgres://jeko:jeko@127.0.0.1:5432/jeko
```

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

## Conoscenza del progetto (`.jeko/`)

Alla radice di ogni progetto gestito da Jeko:

- `project.md`: cos'è, stack, convenzioni;
- `commands.yaml`: `nome: comando` senza shell (es. `test: npm test`), usati dai check con `commands: [typecheck, lint, test]`;
- `notes/*.md`: cose imparate lavorando.

Il runner la passa a claude nel primo turno di ogni run. `nuovo-progetto` la crea, `sviluppo` la aggiorna prima del gate finale.
