// MCP tool definitions (Tier 1: core training + builder + basic analysis).
// Each tool: { name, description, inputSchema, handler, write?, destructive? }

import { gql, todayISO, DEFAULT_TRACK_ID } from './client.mjs';
import { resolveIntervals, validateIntervals } from './intervals.mjs';

// ---- analysis helpers ----

// Concept2 watts from pace (sec/500m). Formula: 2.80 / (pace/500)^3.
function wattsFromPace(paceSecPer500) {
  if (!paceSecPer500 || paceSecPer500 <= 0) return null;
  return 2.8 / Math.pow(paceSecPer500 / 500, 3);
}

function paceString(sec) {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function hrZone(pct) {
  if (pct == null) return null;
  if (pct < 60) return 'Z1';
  if (pct < 70) return 'Z2';
  if (pct < 80) return 'Z3';
  if (pct < 90) return 'Z4';
  return 'Z5';
}

// ---- reusable GraphQL fragments ----

const INTERVAL_DEF = `type value spm spmMax rest undefRest notes restNotes suggestedInterval suggestedOperator suggestedPace suggestedPaceBenchmarkGroup`;
const INTERVAL_RESULT = `type value rest distance avgPace avgSpm maxSpm avgWatts maxWatts calories avgHr maxHr minHr hrZones strokeCount rateConsistency driveLength driveTime recoveryTime avgForce peakForce avgDragFactor`;

export const TOOLS = [
  {
    name: 'auth_check',
    description: 'Verify the token and show the logged-in user (id, name, email, max/resting HR, weight).',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const d = await gql(`query{ currentUser{ id name email maxHeartRate restingHeartRate weight weightUnit } }`);
      if (!d.currentUser) throw new Error('No user: invalid token.');
      return d.currentUser;
    },
  },

  {
    name: 'list_workouts',
    description: 'List the workouts in a track (default: My Workouts). Optional filters: search, limit.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'Track ID (default from ERGZONE_TRACK_ID)' },
        search: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
    },
    async handler({ trackId, search, limit = 50 }) {
      const t = trackId || DEFAULT_TRACK_ID;
      if (!t) throw new Error('No trackId (pass trackId or set ERGZONE_TRACK_ID).');
      const d = await gql(
        `query($t:[ID],$s:String){ workouts(trackIds:$t, search:$s){ id title status publishedAt intervalsLength workoutResultsCount } }`,
        { t: [t], s: search || null },
      );
      const ws = (d.workouts || []).slice(0, limit);
      return { count: ws.length, workouts: ws };
    },
  },

  {
    name: 'get_workout',
    description: 'Full detail of a workout, including all intervals.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async handler({ id }) {
      const d = await gql(
        `query($id:ID!){ workout(id:$id){ id title status publishedAt description workoutType machineTypes intervals{ ${INTERVAL_DEF} } } }`,
        { id },
      );
      if (!d.workout) throw new Error(`Workout ${id} not found.`);
      return d.workout;
    },
  },

  {
    name: 'build_intervals',
    description:
      'Build and validate intervals WITHOUT saving them (preview). Accepts one of: segments (DSL), recipe (ladder|over_under|progressive), intervals (raw). Returns the ready IntervalInput plus any validation errors.',
    inputSchema: {
      type: 'object',
      properties: {
        segments: { type: 'array', items: { type: 'object' } },
        recipe: { type: 'object', description: 'e.g. {kind:"ladder", spmStart:16, spmEnd:30} | {kind:"progressive", blocks:2, faster:0.1} | {kind:"over_under", blocks:[...]}' },
        intervals: { type: 'array', items: { type: 'object' } },
      },
    },
    async handler(args) {
      const intervals = resolveIntervals(args);
      const errors = validateIntervals(intervals);
      return { count: intervals.length, intervals, valid: errors.length === 0, errors };
    },
  },

  {
    name: 'create_workout',
    description:
      'Create a new workout. Intervals from segments | recipe | intervals. publishedAt and workoutType are filled automatically. Validates before sending and reads the result back (round-trip).',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        trackId: { type: 'string' },
        status: { type: 'string', default: 'published', description: 'published | draft' },
        publishedAt: { type: 'string', description: 'YYYY-MM-DD (default: today)' },
        workoutType: { type: 'string', default: 'row' },
        machineTypes: { type: 'array', items: { type: 'string' } },
        segments: { type: 'array', items: { type: 'object' } },
        recipe: { type: 'object' },
        intervals: { type: 'array', items: { type: 'object' } },
      },
      required: ['title'],
    },
    async handler(args) {
      const trackId = args.trackId || DEFAULT_TRACK_ID;
      if (!trackId) throw new Error('No trackId (pass trackId or set ERGZONE_TRACK_ID).');
      const intervals = resolveIntervals(args);
      const errors = validateIntervals(intervals);
      if (errors.length) throw new Error('Invalid intervals: ' + errors.join('; '));

      const workout = {
        trackId,
        title: args.title,
        description: args.description || null,
        status: args.status || 'published',
        publishedAt: args.publishedAt || todayISO(),
        workoutType: args.workoutType || 'row',
        machineTypes: args.machineTypes || [],
        amrap: false,
        hasLeaderboard: false,
        intervals,
      };
      const d = await gql(
        `mutation($w:WorkoutInput!){ workoutUpsert(workout:$w){ id title status publishedAt intervals{ ${INTERVAL_DEF} } } }`,
        { w: workout },
      );
      return { created: d.workoutUpsert };
    },
  },

  {
    name: 'update_workout',
    description: 'Update an existing workout (requires id). Same interval formats as create_workout. If no intervals are passed, only the provided metadata is updated.',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        trackId: { type: 'string' },
        status: { type: 'string' },
        publishedAt: { type: 'string' },
        segments: { type: 'array', items: { type: 'object' } },
        recipe: { type: 'object' },
        intervals: { type: 'array', items: { type: 'object' } },
      },
      required: ['id'],
    },
    async handler(args) {
      const trackId = args.trackId || DEFAULT_TRACK_ID;
      if (!trackId) throw new Error('No trackId.');

      // Fetch the current state for the fields that are not provided.
      const cur = await gql(`query($id:ID!){ workout(id:$id){ title status publishedAt workoutType description } }`, { id: args.id });
      if (!cur.workout) throw new Error(`Workout ${args.id} not found.`);

      const workout = {
        id: args.id,
        trackId,
        title: args.title ?? cur.workout.title,
        description: args.description ?? cur.workout.description,
        status: args.status ?? cur.workout.status,
        publishedAt: args.publishedAt ?? cur.workout.publishedAt ?? todayISO(),
        workoutType: cur.workout.workoutType || 'row',
        machineTypes: [],
        amrap: false,
        hasLeaderboard: false,
      };

      const hasIntervals = args.intervals || args.segments || args.recipe;
      if (hasIntervals) {
        const intervals = resolveIntervals(args);
        const errors = validateIntervals(intervals);
        if (errors.length) throw new Error('Invalid intervals: ' + errors.join('; '));
        workout.intervals = intervals;
      }

      const d = await gql(
        `mutation($w:WorkoutInput!){ workoutUpsert(workout:$w){ id title status publishedAt intervals{ ${INTERVAL_DEF} } } }`,
        { w: workout },
      );
      return { updated: d.workoutUpsert };
    },
  },

  {
    name: 'delete_workout',
    description: 'Delete a workout. Requires confirm:true (irreversible action).',
    write: true,
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        confirm: { type: 'boolean', description: 'Must be true to proceed.' },
      },
      required: ['id'],
    },
    async handler({ id, confirm }) {
      if (confirm !== true) throw new Error('Deletion not confirmed: pass confirm:true.');
      const d = await gql(`mutation($id:ID!){ workoutDelete(id:$id){ id title } }`, { id });
      return { deleted: d.workoutDelete };
    },
  },

  {
    name: 'list_my_results',
    description: 'List my results within a date range (YYYY-MM-DD). Default: last 30 days.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        timezone: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
    },
    async handler({ startDate, endDate, timezone, limit = 50 }) {
      const d = await gql(
        `query($s:String,$e:String,$tz:String){ workoutResults(startDate:$s, endDate:$e, timezone:$tz){ id status ergType elapsedTime elapsedDistance scoreValue insertedAt workout{ id title } } }`,
        { s: startDate || null, e: endDate || null, tz: timezone || null },
      );
      const rs = (d.workoutResults || []).slice(0, limit);
      return { count: rs.length, results: rs };
    },
  },

  {
    name: 'get_result',
    description: 'Detail of a result with per-interval telemetry (pace, SPM, watts, HR, force).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async handler({ id }) {
      const d = await gql(
        `query($id:ID!){ workoutResult(id:$id){ id status ergType elapsedTime elapsedDistance scoreValue workout{ id title } intervals{ ${INTERVAL_RESULT} } } }`,
        { id },
      );
      if (!d.workoutResult) throw new Error(`Result ${id} not found.`);
      return d.workoutResult;
    },
  },

  {
    name: 'my_stats',
    description: 'Aggregate stats (distance/time/calories/days + HR zones) over a period. time: "week"|"month"|"year"|"all".',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'string', default: 'month' },
        ergTypes: { type: 'array', items: { type: 'string' } },
        timezone: { type: 'string' },
      },
    },
    async handler({ time = 'month', ergTypes, timezone }) {
      const d = await gql(
        `query($t:String!,$erg:[String],$tz:String){ myStats(time:$t, ergTypes:$erg, timezone:$tz){ totalDistance totalTime totalCalories totalDays weightedDistance hrZones rates } }`,
        { t: time, erg: ergTypes || null, tz: timezone || null },
      );
      return d.myStats;
    },
  },

  {
    name: 'analyze_result',
    description:
      'Coaching analysis of a result: for each interval computes pace, SPI (watts/SPM), %HR and zone. Uses the passed maxHr or the profile value.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        maxHr: { type: 'number', description: 'Max HR for the zones (default: user profile)' },
      },
      required: ['id'],
    },
    async handler({ id, maxHr }) {
      const d = await gql(
        `query($id:ID!){ workoutResult(id:$id){ id elapsedTime elapsedDistance workout{ title } intervals{ ${INTERVAL_RESULT} } } }`,
        { id },
      );
      const r = d.workoutResult;
      if (!r) throw new Error(`Result ${id} not found.`);

      let hrMax = maxHr;
      if (!hrMax) {
        const u = await gql(`query{ currentUser{ maxHeartRate } }`);
        hrMax = u.currentUser?.maxHeartRate || null;
      }

      const rows = (r.intervals || []).map((iv, i) => {
        const watts = iv.avgWatts ?? wattsFromPace(iv.avgPace);
        const spi = watts && iv.avgSpm ? +(watts / iv.avgSpm).toFixed(1) : null;
        const pct = iv.avgHr && hrMax ? Math.round((iv.avgHr / hrMax) * 100) : null;
        return {
          interval: i + 1,
          type: iv.type,
          value: iv.value,
          pace: paceString(iv.avgPace),
          spm: iv.avgSpm,
          watts: watts ? Math.round(watts) : null,
          spi,
          avgHr: iv.avgHr,
          hrPct: pct,
          zone: hrZone(pct),
          rateConsistency: iv.rateConsistency,
        };
      });

      return {
        workout: r.workout?.title,
        elapsedTime: r.elapsedTime,
        elapsedDistance: r.elapsedDistance,
        maxHrUsed: hrMax,
        intervals: rows,
      };
    },
  },
];
