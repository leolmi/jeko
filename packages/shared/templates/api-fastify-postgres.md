# API REST Node (Fastify + PostgreSQL)

Servizio REST in TypeScript con Fastify e PostgreSQL, pronto da avviare in locale con Docker.

- Node 22+, TypeScript strict, ESM. Avvio in sviluppo con `tsx watch`, build con `tsc`.
- Fastify con validazione degli schemi (TypeBox), log con pino, configurazione da variabili d'ambiente (`.env.example`, niente segreti nel repo).
- PostgreSQL con `pg`: `docker-compose.yml` per il database locale e migrazioni SQL semplici, applicate all'avvio.
- Un esempio completo: risorsa `items` con CRUD (`/api/items`) e `GET /api/health`.
- Test con Vitest sulle rotte (`app.inject`), con un database di test.
- ESLint e Prettier, con gli script `lint` e `format`.
- README breve: requisiti, avvio del database, comandi.
- Alla fine verifica che build, test e lint passino.
