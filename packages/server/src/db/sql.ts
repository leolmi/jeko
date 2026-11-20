/** Timestamp ISO 8601 in UTC, con millisecondi. */
export const iso = (col: string) =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Parametro jsonb: sempre serializzato, uguale per pg e PGlite. */
export const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
