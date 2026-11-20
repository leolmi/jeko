# Libreria TypeScript per npm

Pacchetto TypeScript da pubblicare su npm, con tipi, test e build pronti.

- TypeScript strict, ESM, `exports` nel `package.json` con i tipi (`.d.ts`); build con `tsc` in `dist/`.
- `src/index.ts` con una funzione d'esempio documentata (JSDoc) e i suoi test con Vitest.
- `files` nel `package.json` limitato a `dist/`; script `build`, `test`, `lint`, `format` e `prepublishOnly` (build e test).
- ESLint e Prettier.
- README breve: installazione, uso, sviluppo. Licenza MIT.
- Non pubblicare nulla su npm.
- Alla fine verifica che build, test e lint passino.
