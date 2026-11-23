# Jeko

Monorepo npm workspaces (`packages/`):

- `shared`: contratto TypeBox (`src/contract.ts`), usato da server e admin tramite `dist/`.
- `server`: Fastify; dati in file JSON nella cartella dati (es. `projects.json` via `ProjectStore`); rotte in `src/routes/`.
- `admin`: Angular 22 standalone, signals, OnPush, Tailwind (token `bg`, `subtle`, `line`, `fg`, `muted`, `faint`, `accent`).
- `runner`: esegue i task di claude sul PC.

Convenzioni:

- Commenti e test in italiano; testi UI in `admin/src/app/core/i18n.ts` (IT ed EN).
- Icone: tracciati SVG Material in `admin/src/app/ui/icon.ts` (aggiungerle lì, niente font).
- Preferenze solo locali in `core/storage.ts` (localStorage `jeko.*`); dati condivisi tra app installata e dev nel server.
- Niente dipendenze UI extra (no `@angular/cdk`): drag&drop con HTML5 nativo.
- Logica pura estratta in file a parte e testata con `*.spec.ts` (es. `workspace/project-list.ts`); test server in `server/src/app.test.ts` con `app.inject`.
