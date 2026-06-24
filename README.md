# ergzone-mcp

Server **MCP** non ufficiale per **ErgZone** (Concept2 rowing). **Zero dipendenze runtime**: solo Node ≥ 18 (usa `fetch` globale e stdio nativi). Un file `.mjs`, nessun `npm install`.

> Non affiliato a ErgZone / Concept2. Tool di terze parti per uso personale.

## Requisiti

- Node ≥ 18 (testato su Node 26)
- Un `SESSION_TOKEN` ErgZone valido (vedi sotto)

## Come ottenere il token

1. Apri `https://admin.erg.zone` e fai login (OAuth Concept2 Logbook).
2. DevTools → Console: `localStorage.SESSION_TOKEN`
3. Copia il valore in `ERGZONE_SESSION_TOKEN`.

Il token è un `Phoenix.Token` con scadenza: quando scade, il server risponde con errore `auth` e va rigenerato.

## Installazione

Nessun clone, nessun `npm install`, nessun build: `npx` esegue direttamente da GitHub.

### Claude Code

```bash
claude mcp add ergzone \
  -e ERGZONE_SESSION_TOKEN=SFM... \
  -e ERGZONE_TRACK_ID=0e3a990f-d7b2-477a-ac32-16795f7a32e0 \
  -- npx -y github:malveo/ergzone-mcp
```

Fissa una versione con un tag (consigliato, `npx` cacha):

```bash
... -- npx -y github:malveo/ergzone-mcp#v0.1.0
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ergzone": {
      "command": "npx",
      "args": ["-y", "github:malveo/ergzone-mcp"],
      "env": {
        "ERGZONE_SESSION_TOKEN": "SFM...",
        "ERGZONE_TRACK_ID": "0e3a990f-d7b2-477a-ac32-16795f7a32e0"
      }
    }
  }
}
```

### Variabili (vedi `.env.example`)

| Var | Default | Note |
|-----|---------|------|
| `ERGZONE_SESSION_TOKEN` | — | obbligatorio |
| `ERGZONE_TRACK_ID` | — | track di default per `list_workouts` / `create_workout` |
| `ERGZONE_ENDPOINT` | `https://production.erg.zone/api` | |
| `ERGZONE_ALLOW_WRITE` | `true` | `false` = solo lettura (blocca create/update/delete) |

## Tool (Tier 1)

| Tool | Tipo | Descrizione |
|------|------|-------------|
| `auth_check` | 🟢 | verifica token + utente |
| `list_workouts` | 🟢 | elenca workout di un track |
| `get_workout` | 🟢 | dettaglio + intervalli |
| `build_intervals` | 🟢 | anteprima/validazione intervalli (no salvataggio) |
| `create_workout` | 🟡 | crea workout |
| `update_workout` | 🟡 | aggiorna workout |
| `delete_workout` | 🔴 | elimina (richiede `confirm:true`) |
| `list_my_results` | 🟢 | miei risultati per data |
| `get_result` | 🟢 | telemetria per intervallo |
| `my_stats` | 🟢 | aggregati + zone HR |
| `analyze_result` | 🟢 | pace / SPI / %HR / zona per intervallo |

🟢 lettura · 🟡 scrive dati propri · 🔴 distruttivo (gate `confirm`)

## Builder intervalli

`create_workout` / `update_workout` / `build_intervals` accettano **uno** tra:

### `recipe` (alto livello)

```jsonc
// SPM ladder 16/17 -> 30/31, 1' rest 20s
{ "kind": "ladder", "spmStart": 16, "spmEnd": 30 }

// Progressivo intensity: 2 blocchi, ogni step 0.1s/500m piu' veloce del precedente
{ "kind": "progressive", "blocks": 2, "faster": 0.1,
  "pattern": ["1:00","2:00","1:00","3:00","1:00","4:00"], "restBetween": "4:00" }

// Over/under SPM
{ "kind": "over_under", "restBetween": "1:00",
  "blocks": [
    { "baseWork": "4:00", "baseSpm": 18, "surgeWork": "2:00", "surgeSpm": 22 },
    { "baseWork": "4:00", "baseSpm": 20, "surgeWork": "2:00", "surgeSpm": 24 }
  ] }
```

### `segments` (DSL generica)

```jsonc
[
  { "time": "4:00", "spm": 18 },
  { "time": "2:00", "spm": 22, "rest": "1:00" },
  { "distance": 500, "spm": 24 },
  { "time": "2:00", "fasterThanPrev": 0.1 },          // 0.1s/500m piu' veloce del precedente
  { "time": "2:00", "fasterThan": { "interval": 1, "seconds": 0.2 } },
  { "time": "2:00", "benchmark": { "group": "A", "offset": -1.5 } }  // rispetto a un PR salvato
]
```

Durate: `"M:SS"` o secondi. Il builder gestisce in automatico l'encoding `suggested*`
(0-based, group `INTERVAL`, operatore `+`, pace negativo = più veloce) e valida prima di salvare.

## Avvio manuale / debug

```bash
ERGZONE_SESSION_TOKEN=... node bin/ergzone-mcp.mjs
```

Parla JSON-RPC su stdin/stdout. I log diagnostici vanno su stderr.

## Architettura

```
bin/ergzone-mcp.mjs   entry (#!/usr/bin/env node)
src/mcp.mjs           loop JSON-RPC stdio
src/tools.mjs         definizioni tool + handler
src/intervals.mjs     builder/validazione intervalli
src/client.mjs        fetch GraphQL + normalizzazione errori
```

Riferimento schema GraphQL completo: vedi `../allenamento-vogatore/MCP.md`.
