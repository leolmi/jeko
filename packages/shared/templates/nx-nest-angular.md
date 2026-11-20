# Monorepo Nx: NestJS + Angular

Monorepo Nx con backend NestJS, frontend Angular, una libreria di componenti e una di tipi condivisi.

- Crea il workspace Nx vuoto dalla cartella che contiene {{ dir }}: `npx create-nx-workspace@latest {{ slug }} --preset=apps --pm=npm --skipGit=true --nxCloud=skip --interactive=false`.
- Aggiungi i plugin `@nx/angular` e `@nx/nest` (`npx nx add …`).
- `apps/web`: app Angular (standalone, routing, scss, e2e con Playwright).
- `apps/api`: app NestJS con prefisso `/api` e un endpoint `GET /api/hello`; il proxy di `web` gira le chiamate `/api` al backend.
- `libs/ui`: libreria Angular di componenti, con almeno un componente d'esempio usato da `web`.
- `libs/shared`: tipi TypeScript condivisi tra `api` e `web` (es. la risposta di `/api/hello`).
- La pagina iniziale di `web` chiama `/api/hello` e mostra il messaggio con il componente di `ui`; il test e2e lo verifica.
- TypeScript strict, ESLint e Prettier di Nx.
- README breve: struttura e comandi (`nx serve api`, `nx serve web`, build, test, e2e, lint).
- Alla fine verifica che `npx nx run-many -t lint test build` passi, e anche l'e2e di `web`.
