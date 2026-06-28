# ergzone-mcp

[![Release](https://github.com/malveo/ergzone-mcp/actions/workflows/release.yml/badge.svg)](https://github.com/malveo/ergzone-mcp/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/ergzone-mcp.svg)](https://www.npmjs.com/package/ergzone-mcp)
[![license](https://img.shields.io/npm/l/ergzone-mcp.svg)](LICENSE)

Unofficial MCP server for [ErgZone](https://www.erg.zone) (Concept2 rowing). Manage workouts, results and stats from your AI assistant. **Zero install, zero dependencies** — runs via `npx` from npm (Node ≥ 18).

> Not affiliated with ErgZone / Concept2. Personal use.

## Setup

You need a Concept2 Logbook account (the one you use on log.concept2.com).

### Claude Desktop — one-click (no terminal)

1. [Download `ergzone-mcp.mcpb`](https://github.com/malveo/ergzone-mcp/releases/latest/download/ergzone-mcp.mcpb) (direct link, always the latest).
2. Double-click it (or drag it into Claude Desktop → Settings → Extensions).
3. Type your Logbook email and password in the form, and make sure the extension is **enabled**. Done.

Nothing to install — no Node, no terminal, no config files. Full walkthrough with screenshots: [docs/claude-desktop.md](docs/claude-desktop.md).

### Claude Code (terminal)

```bash
claude mcp add ergzone \
  -e ERGZONE_LOGBOOK_EMAIL=you@example.com \
  -e ERGZONE_LOGBOOK_PASSWORD=yourpassword \
  -- npx -y ergzone-mcp
```

### Claude Desktop — manual config

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ergzone": {
      "command": "npx",
      "args": ["-y", "ergzone-mcp"],
      "env": {
        "ERGZONE_LOGBOOK_EMAIL": "you@example.com",
        "ERGZONE_LOGBOOK_PASSWORD": "yourpassword"
      }
    }
  }
}
```

The server logs in for you and caches the token (`~/.config/ergzone-mcp/`, refreshed on expiry).
Prefer not to store your password? Use `ERGZONE_SESSION_TOKEN` instead (copied from
`localStorage.SESSION_TOKEN` on admin.erg.zone).

## Tools

| Tool | What it does |
|------|------|
| `auth_check` | who am I |
| `update_profile` | set max HR, resting HR, weight, weight unit |
| `list_workouts` / `get_workout` | browse workouts |
| `create_workout` / `update_workout` / `delete_workout` | manage workouts |
| `build_intervals` | preview intervals before saving |
| `list_my_results` / `get_result` | your sessions + telemetry |
| `my_stats` / `analyze_result` | totals, HR zones, pace/SPI per interval |

## Example prompts

Just talk to Claude in plain language:

- **Check it works** — *"Am I connected to ErgZone? Who am I?"*
- **Browse** — *"List my ErgZone workouts."*
- **Build (preview, nothing saved)** — *"Show me an SPM ladder from 16 to 30 spm, 1 min each."*
- **Create** — *"Create a workout 'Tuesday tempo' with 3 × 2 min at 22 spm, 1 min rest."*
- **Progressive intensity** — *"Build a workout: 2 blocks of 1-2-1-3-1-4 minutes, each interval 0.1s/500m faster than the previous, 4 min rest between blocks."*
- **Results** — *"Show my last few ErgZone results."*
- **Profile** — *"Set my max heart rate to 186."*
- **Analysis** — *"Analyze my last result: pace, SPI and HR zone per interval."*
- **Stats** — *"How many meters did I row this month?"*
- **Tidy up** — *"Delete the workout 'Tuesday tempo'."*

## Settings

| Var | Notes |
|-----|------|
| `ERGZONE_LOGBOOK_EMAIL` + `ERGZONE_LOGBOOK_PASSWORD` | auto-login (recommended) |
| `ERGZONE_SESSION_TOKEN` | alternative to the two above |
| `ERGZONE_TRACK_ID` | default workout list (optional) |
| `ERGZONE_ALLOW_WRITE` | `false` = read-only |

## Notes

Auto-login stores your Logbook password and replicates the Logbook sign-in, so it may break if
Concept2 changes that page, and automating login may be against their Terms of Service.

Works on macOS, Linux and Windows (Node ≥ 18.7). The token cache lives under
`~/.config/ergzone-mcp` (macOS/Linux) or `%APPDATA%\ergzone-mcp` (Windows).

MIT licensed.
