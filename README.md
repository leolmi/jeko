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

- Node ≥ 22 e Git, sul PC del runner insieme a Claude Code.
- Postgres per il server, in container con [`docker-compose.yml`](docker-compose.yml): basta Docker Engine con il plugin Compose (gratuiti). Docker Desktop non serve. Per i test basta PGlite, senza container.

### Docker Engine e Compose

**Windows** (in WSL2, senza Docker Desktop):

1. In PowerShell da amministratore: `wsl --install -d Ubuntu`, poi riavvia e crea l'utente di Ubuntu.
2. In Ubuntu, installa Docker Engine e il plugin Compose seguendo la [guida ufficiale per Ubuntu](https://docs.docker.com/engine/install/ubuntu/) (pacchetti `docker-ce` e `docker-compose-plugin`).
3. Per usare `docker` senza `sudo`: `sudo usermod -aG docker $USER`, poi chiudi e riapri Ubuntu.

WSL2 inoltra le porte a Windows: il database risponde su `127.0.0.1:5432` anche da PowerShell.

**Linux**: Docker Engine e `docker-compose-plugin` dai pacchetti ufficiali, come sopra.

**Podman** (alternativa): `podman compose` legge lo stesso file.

### Database

Dalla cartella di Jeko (in WSL: `cd /mnt/c/<percorso>/jeko`):

```sh
docker compose up -d      # Postgres su 127.0.0.1:5432, dati nel volume jeko_db
docker compose down       # lo ferma; i dati restano nel volume
```

Il server usa `postgres://jeko:jeko@127.0.0.1:5432/jeko` se `DATABASE_URL` non dice altro. Al primo avvio crea le tabelle e carica i workflow di serie.

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
