# ergzone-mcp

Unofficial **MCP** server for **ErgZone** (Concept2 rowing). **Zero runtime dependencies**: just Node ≥ 18 (uses the global `fetch` and native stdio). A single `.mjs`, no `npm install`.

> Not affiliated with ErgZone / Concept2. Third-party tool for personal use.

## Requirements

- Node ≥ 18 (tested on Node 26)
- A valid ErgZone `SESSION_TOKEN` (see below)

## Authentication

Two ways, pick one.

### Option A — paste a session token

1. Open `https://admin.erg.zone` and log in (Concept2 Logbook OAuth).
2. DevTools → Console: `localStorage.SESSION_TOKEN`
3. Copy the value into `ERGZONE_SESSION_TOKEN`.

The token is a `Phoenix.Token` with an expiry: when it expires the server returns an `auth` error and it must be regenerated.

### Option B — Concept2 Logbook credentials (auto-login)

Set `ERGZONE_LOGBOOK_EMAIL` + `ERGZONE_LOGBOOK_PASSWORD`. The server logs in to ErgZone
headlessly (pure HTTP, no browser, no extra install), obtains the session token, caches it
under `~/.config/ergzone-mcp/` (chmod 600) and refreshes it automatically when it expires.

Best UX for non-technical users: set it once, never touch a token again.

> ⚠️ Caveats: this stores your Logbook password and replicates the Logbook login form, so it
> may break if Concept2 changes that form, and automating a non-SSO login may be against the
> Concept2/ErgZone Terms of Service. Use Option A if you prefer not to store credentials.

## Installation

No clone, no `npm install`, no build: `npx` runs it straight from GitHub.

### Claude Code

```bash
claude mcp add ergzone \
  -e ERGZONE_SESSION_TOKEN=SFM... \
  -e ERGZONE_TRACK_ID=0e3a990f-d7b2-477a-ac32-16795f7a32e0 \
  -- npx -y github:malveo/ergzone-mcp
```

Pin a version with a tag (recommended, `npx` caches):

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

### Environment variables (see `.env.example`)

| Var | Default | Notes |
|-----|---------|-------|
| `ERGZONE_SESSION_TOKEN` | — | auth option A (paste a token) |
| `ERGZONE_LOGBOOK_EMAIL` | — | auth option B (Logbook auto-login) |
| `ERGZONE_LOGBOOK_PASSWORD` | — | auth option B |
| `ERGZONE_TRACK_ID` | — | default track for `list_workouts` / `create_workout` |
| `ERGZONE_ENDPOINT` | `https://production.erg.zone/api` | |
| `ERGZONE_ALLOW_WRITE` | `true` | `false` = read-only (blocks create/update/delete) |

Provide either `ERGZONE_SESSION_TOKEN` (A) or both `ERGZONE_LOGBOOK_EMAIL` + `ERGZONE_LOGBOOK_PASSWORD` (B).

## Tools (Tier 1)

| Tool | Type | Description |
|------|------|-------------|
| `auth_check` | 🟢 | verify token + user |
| `list_workouts` | 🟢 | list workouts in a track |
| `get_workout` | 🟢 | detail + intervals |
| `build_intervals` | 🟢 | preview/validate intervals (no save) |
| `create_workout` | 🟡 | create a workout |
| `update_workout` | 🟡 | update a workout |
| `delete_workout` | 🔴 | delete (requires `confirm:true`) |
| `list_my_results` | 🟢 | my results by date |
| `get_result` | 🟢 | per-interval telemetry |
| `my_stats` | 🟢 | aggregates + HR zones |
| `analyze_result` | 🟢 | pace / SPI / %HR / zone per interval |

🟢 read · 🟡 writes own data · 🔴 destructive (gated by `confirm`)

## Interval builder

`create_workout` / `update_workout` / `build_intervals` accept **one** of:

### `recipe` (high level)

```jsonc
// SPM ladder 16/17 -> 30/31, 1' work, 20s rest
{ "kind": "ladder", "spmStart": 16, "spmEnd": 30 }

// Progressive intensity: 2 blocks, each step 0.1s/500m faster than the previous
{ "kind": "progressive", "blocks": 2, "faster": 0.1,
  "pattern": ["1:00","2:00","1:00","3:00","1:00","4:00"], "restBetween": "4:00" }

// SPM over/under
{ "kind": "over_under", "restBetween": "1:00",
  "blocks": [
    { "baseWork": "4:00", "baseSpm": 18, "surgeWork": "2:00", "surgeSpm": 22 },
    { "baseWork": "4:00", "baseSpm": 20, "surgeWork": "2:00", "surgeSpm": 24 }
  ] }
```

### `segments` (generic DSL)

```jsonc
[
  { "time": "4:00", "spm": 18 },
  { "time": "2:00", "spm": 22, "rest": "1:00" },
  { "distance": 500, "spm": 24 },
  { "time": "2:00", "fasterThanPrev": 0.1 },          // 0.1s/500m faster than the previous
  { "time": "2:00", "fasterThan": { "interval": 1, "seconds": 0.2 } },
  { "time": "2:00", "benchmark": { "group": "A", "offset": -1.5 } }  // relative to a saved PR
]
```

Durations: `"M:SS"` or seconds. The builder handles the `suggested*` encoding automatically
(0-based, group `INTERVAL`, operator `+`, negative pace = faster) and validates before saving.

## Manual run / debug

```bash
ERGZONE_SESSION_TOKEN=... node bin/ergzone-mcp.mjs
```

Speaks JSON-RPC over stdin/stdout. Diagnostic logs go to stderr.

## Architecture

```
bin/ergzone-mcp.mjs   entry (#!/usr/bin/env node)
src/mcp.mjs           JSON-RPC stdio loop
src/tools.mjs         tool definitions + handlers
src/intervals.mjs     interval builder / validation
src/client.mjs        GraphQL fetch + token resolution + error normalization
src/auth.mjs          headless Logbook login + token cache (modular steps)
```
