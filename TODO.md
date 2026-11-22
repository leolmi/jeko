# Da fare

- **Cambio della modalità durante un task**: vale dal prossimo gate o domanda, senza pausa;
  serve un messaggio server → runner.
- **Modifiche non salvate ai workflow**: oggi restano solo in memoria.
- **Messaggi a metà turno**: hook PostToolUse che legge i messaggi in attesa (file nella
  cartella del turno) e li passa a claude come contesto; senza strumenti restano in coda.
