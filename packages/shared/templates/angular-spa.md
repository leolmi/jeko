# Angular SPA con libreria di componenti

Applicazione Angular a pagina singola, con una libreria di componenti nello stesso workspace e i test e2e con Playwright.

- Genera il workspace con Angular CLI (ultima versione stabile) direttamente in {{ dir }}: `npx @angular/cli@latest new {{ slug }} --directory "{{ dir }}" --routing --style=scss --ssr=false --skip-git`.
- Aggiungi la libreria di componenti `ui` (`ng generate library ui`) con almeno un componente d'esempio (es. un pulsante) esportato dall'API pubblica, e usalo nella pagina iniziale dell'app.
- Componenti standalone e signals, TypeScript strict.
- Test e2e con Playwright in `e2e/`: `@playwright/test` come dipendenza di sviluppo, `playwright.config.ts` con `webServer` che avvia l'app, script `npm run e2e`, un test che apre la pagina iniziale e trova il componente della libreria. Installa solo il browser chromium.
- ESLint (`ng add angular-eslint`) e Prettier, con gli script `lint` e `format`.
- README breve: cosa c'è e i comandi (avvio, build, test, e2e, lint).
- Alla fine verifica che build, test unitari, lint ed e2e passino.
