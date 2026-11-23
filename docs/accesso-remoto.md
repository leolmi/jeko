---
layout: default
title: Accesso remoto
---

# Accesso remoto

Segui e gestisci i task di Jeko dal telefono (o da un altro computer), anche fuori casa. Si apre una pagina nel browser, senza app da installare. Ogni installazione di Jeko ha il suo accesso: canale, chiavi e QR si generano sul tuo PC.

## Cosa si può fare da remoto

- vedere progetti (con i preferiti) e task, con il loro andamento, modello e impegno;
- avviare un task nella cartella di un progetto, o continuarne uno concluso;
- rispondere alle domande di Claude e approvare o rifiutare i gate;
- annullare un task.

Il resto (opzioni, workflow, progetti nuovi) resta sul PC.

## Come funziona

```
telefono ──HTTPS──▶ relay ◀──WebSocket── Jeko sul PC
```

- Il **relay** è un piccolo server ponte: serve la pagina remota e smista i messaggi tra Jeko e i dispositivi. Jeko si collega lui al relay, quindi sul PC non si apre nessuna porta verso l'esterno.
- I messaggi sono **cifrati da un capo all'altro** (AES-GCM) con una chiave diversa per ogni dispositivo. Il relay non li può leggere: tiene solo l'ultimo stato cifrato di ogni dispositivo, così la pagina mostra qualcosa anche se Jeko è momentaneamente scollegato.
- La chiave sta nel **QR**, nella parte del link dopo `#`, che il browser non manda mai al server.

## Configurazione con Tailscale Funnel (consigliata)

Il relay gira dentro Jeko, sul tuo PC; [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) lo rende raggiungibile da internet in HTTPS, con un indirizzo fisso e senza toccare il router.

1. Installa [Tailscale](https://tailscale.com/download) sul PC e accedi con un tuo account.
2. Abilita Funnel: la prima volta il comando del punto 3 ti dà un link alla console di Tailscale dove attivarlo (servono anche i certificati HTTPS, li propone la stessa pagina).
3. Esponi la porta del relay (resta attivo anche dopo un riavvio):

   ```sh
   tailscale funnel --bg 8787
   ```

   `tailscale funnel status` mostra l'indirizzo, del tipo `https://<nome-pc>.<tailnet>.ts.net`.

4. In Jeko, **Opzioni → Accesso remoto**:
   - indirizzo del relay: quello del punto 3;
   - spunta **Relay su questo PC** e **Attivo**, poi **Salva**.

   Lo stato diventa «Collegato al relay». Jeko avvia il relay su `127.0.0.1:8787` e genera da sé il segreto che impedisce ad altri di aprire canali sul tuo relay.

## Collegare un dispositivo

1. **Collega un dispositivo**: compare un QR, valido 15 minuti.
2. Inquadralo col telefono (o copia il link) e apri la pagina.
3. Il dispositivo compare nell'elenco come «da confermare»: premi **Conferma** sul PC. Solo da quel momento vede i dati e può fare richieste.

Per toglierlo: il cestino accanto al dispositivo. La pagina sul telefono si chiude e, per riusarlo, va collegato di nuovo.

## Da sapere

- **Il PC deve essere acceso e Jeko attivo.** Con dispositivi confermati il servizio non si spegne più da solo alla chiusura della finestra. Con il relay su questo PC, a PC spento la pagina non si raggiunge.
- **Chi apre l'indirizzo senza QR** vede la pagina, ma non può fare nulla: senza chiave non legge né manda messaggi, e senza conferma sul PC una chiave non basta.
- **Non condividere il QR o il link**: contengono la chiave del dispositivo.
- Dati sul PC, in `%LOCALAPPDATA%\jeko\data`: `remote.json` (canale, segreto, dispositivi con le chiavi) e `relay/channels.json` (solo hash dei token).

## In alternativa: un relay su un server

Il relay è anche un programma a sé (`packages/relay`, vedi il suo [README](https://github.com/leolmi/jeko/tree/main/packages/relay)) da far girare su un server raggiungibile in HTTPS. In quel caso in Jeko si lascia spenta «Relay su questo PC», si scrive l'indirizzo del server e, se il relay ha `RELAY_SECRET`, lo stesso segreto. Utile se vuoi che la pagina mostri l'ultimo stato anche a PC spento.
