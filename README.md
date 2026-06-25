# ergzone-mcp

Unofficial MCP server for [ErgZone](https://www.erg.zone) (Concept2 rowing). Manage workouts, results and stats from your AI assistant. **Zero install, zero dependencies** — runs via `npx` from npm (Node ≥ 18).

> Not affiliated with ErgZone / Concept2. Personal use.

## Setup

You need a Concept2 Logbook account (the one you use on log.concept2.com).

**Claude Code:**

```bash
claude mcp add ergzone \
  -e ERGZONE_LOGBOOK_EMAIL=you@example.com \
  -e ERGZONE_LOGBOOK_PASSWORD=yourpassword \
  -- npx -y ergzone-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`:

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
| `list_workouts` / `get_workout` | browse workouts |
| `create_workout` / `update_workout` / `delete_workout` | manage workouts |
| `build_intervals` | preview intervals before saving |
| `list_my_results` / `get_result` | your sessions + telemetry |
| `my_stats` / `analyze_result` | totals, HR zones, pace/SPI per interval |

Ask in plain language, e.g. *"create an SPM ladder 16 to 30"* or *"analyze my last result"*.

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
