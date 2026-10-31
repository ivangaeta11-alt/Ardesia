# Ardesia

Applicazione web installabile per scrittura a mano digitale. Il progetto usa JavaScript ES modules, Canvas 2D e un server locale Node.js senza framework frontend.

## Requisiti

- Node.js 18 o successivo
- npm

## Sviluppo locale

```sh
npm install
npm start
```

Apri `http://localhost:4173`. Su Windows puoi anche avviare `Avvia Ardesia.cmd`.

## Comandi

```sh
npm run check       # controlla la sintassi JavaScript
npm test            # esegue i test Node.js
npm run build:site  # genera il sito statico in dist/
```

Il server locale serve i file dalla radice del progetto. La build copia in `dist/` solo i file necessari alla versione web pubblicata. `netlify.toml` configura Netlify per generare e pubblicare quella cartella a ogni aggiornamento del branch principale.

## Struttura

- `src/`: applicazione, acquisizione della penna, geometria, rendering, salvataggio e componenti UI
- `tests/`: test automatici basati sul runner integrato di Node.js
- `assets/`: icone e script per generarle
- `vendor/`: copie locali delle librerie browser e relative licenze
- `scripts/build-site.mjs`: preparazione dei file per la pubblicazione
- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`: shell web e PWA

Il renderer attivo è quello geometrico CosaStudio. Il formato dei quaderni usa coordinate indipendenti dallo zoom. I dati vengono salvati nel browser e non sincronizzati con un server. Esporta backup regolari dal menu dell'app.

## Pubblicazione

Il repository include `netlify.toml`. Importalo in Netlify per pubblicare automaticamente `dist/` dopo ogni push. La configurazione di build non richiede credenziali né variabili d'ambiente.

## Licenze

Il codice applicativo non include una licenza open source. I file di librerie in `vendor/` mantengono le licenze originali accanto alle copie.
