# CLAUDE.md

Unofficial MCP server for ErgZone (Concept2 rowing). Zero runtime dependencies, pure Node `fetch` (≥18.7), stdio JSON-RPC.

## Workflow rules

- **Every tool/feature change → update `README.md`** (tools table + example prompts) in the same flow, then commit and push.
- Conventional Commits. `feat:`/`fix:` bump a version via semantic-release on push to `main` and rebuild the `.mcpb`; `docs:`/`chore:` do not.
- Push to `main` triggers `.github/workflows/release.yml` (semantic-release): builds `ergzone-mcp.mcpb` and publishes a GitHub release.

## Architecture (`src/`)

- `mcp.mjs` — stdio JSON-RPC loop (initialize, tools/list, tools/call, ping). Gates `write` tools on `ERGZONE_ALLOW_WRITE`.
- `tools.mjs` — `TOOLS` array. Each tool: `{ name, description, inputSchema, handler, write?, destructive? }`. This is the only place tools are declared (manifest does not list them).
- `client.mjs` — GraphQL client. `gql(query, vars)` against `ERGZONE_ENDPOINT` (default `https://production.erg.zone/api`). Token resolution + one auto-refresh on auth failure. `resolveTrackId()` auto-detects the personal "My Workouts" track.
- `auth.mjs` — headless Concept2 Logbook login (OAuth), token cached at `~/.config/ergzone-mcp/` (0600).
- `intervals.mjs` — interval DSL / recipe builders + validation.

## ErgZone GraphQL notes

- Introspection is **disabled** in prod (`__type`/`__schema` return null). To discover schema, probe field names and read the error messages ("Cannot query field X" = absent; "must have a selection of subfields" / "Expected type ..." = present). Probe existence with a deliberately wrong type (e.g. `[1]`) to avoid mutating.
- Profile (HR/weight) mutation: `settingsUpdate(settings: SettingsInput!): User`. `SettingsInput` fields: `maxHeartRate:Int`, `restingHeartRate:Int`, `weight:Int`, `weightUnit:String` (`kg`/`lbs`). `userUpdate(user: UserInput!)` exists but does NOT carry these fields.
- Workout mutation: `workoutUpsert(workout: WorkoutInput!)`. Delete: `workoutDelete(id)`.
- **Caution**: profile/settings mutations execute immediately on a successful call — there is no dry-run. Do not "probe" them with real field values; use type-mismatch probes for discovery.

## Run / dev

- `npm start` → `node bin/ergzone-mcp.mjs`.
- Local MCP config: `.mcp.json` (Logbook creds + track id). Token cache lets ad-hoc scripts reuse the session without re-login.
