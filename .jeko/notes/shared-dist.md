# L'admin legge shared da dist/

Dopo una modifica a `packages/shared/src/contract.ts`, il typecheck dell'admin dà errori
("Property … does not exist") finché non si esegue `npm run build -w @jeko/shared`.

`npm run typecheck` dell'admin non controlla i template Angular: per quelli serve
`npm run build -w @jeko/admin`. Gli avvisi di budget e di `ajv` non ESM nella build ci sono già.
