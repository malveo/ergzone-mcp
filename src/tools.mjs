// Definizioni tool MCP (Tier 1: core training + builder + analisi base).
// Ogni tool: { name, description, inputSchema, handler, write?, destructive? }

import { gql, todayISO, DEFAULT_TRACK_ID } from './client.mjs';
import { resolveIntervals, validateIntervals } from './intervals.mjs';

// ---- helper di analisi ----

// watt Concept2 da pace (sec/500m). Formula: 2.80 / (pace/500)^3.
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

// ---- frammenti GraphQL riusabili ----

const INTERVAL_DEF = `type value spm spmMax rest undefRest notes restNotes suggestedInterval suggestedOperator suggestedPace suggestedPaceBenchmarkGroup`;
const INTERVAL_RESULT = `type value rest distance avgPace avgSpm maxSpm avgWatts maxWatts calories avgHr maxHr minHr hrZones strokeCount rateConsistency driveLength driveTime recoveryTime avgForce peakForce avgDragFactor`;

export const TOOLS = [
  {
    name: 'auth_check',
    description: 'Verifica il token e mostra l\'utente loggato (id, nome, email, ruolo, HR max/riposo, peso).',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const d = await gql(`query{ currentUser{ id name email maxHeartRate restingHeartRate weight weightUnit } }`);
      if (!d.currentUser) throw new Error('Nessun utente: token non valido.');
      return d.currentUser;
    },
  },

  {
    name: 'list_workouts',
    description: 'Elenca i workout di un track (default: My Workouts). Filtri opzionali: search, limit.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'Track ID (default da ERGZONE_TRACK_ID)' },
        search: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
    },
    async handler({ trackId, search, limit = 50 }) {
      const t = trackId || DEFAULT_TRACK_ID;
      if (!t) throw new Error('Nessun trackId (passa trackId o imposta ERGZONE_TRACK_ID).');
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
    description: 'Dettaglio completo di un workout, inclusi tutti gli intervalli.',
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
      if (!d.workout) throw new Error(`Workout ${id} non trovato.`);
      return d.workout;
    },
  },

  {
    name: 'build_intervals',
    description:
      'Costruisce e valida intervalli SENZA salvarli (anteprima). Accetta uno tra: segments (DSL), recipe (ladder|over_under|progressive), intervals (raw). Restituisce gli IntervalInput pronti + eventuali errori di validazione.',
    inputSchema: {
      type: 'object',
      properties: {
        segments: { type: 'array', items: { type: 'object' } },
        recipe: { type: 'object', description: 'es. {kind:"ladder", spmStart:16, spmEnd:30} | {kind:"progressive", blocks:2, faster:0.1} | {kind:"over_under", blocks:[...]}' },
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
      'Crea un nuovo workout. Intervalli da segments | recipe | intervals. publishedAt e workoutType riempiti in automatico. Valida prima di inviare e rilegge il risultato (round-trip).',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        trackId: { type: 'string' },
        status: { type: 'string', default: 'published', description: 'published | draft' },
        publishedAt: { type: 'string', description: 'YYYY-MM-DD (default: oggi)' },
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
      if (!trackId) throw new Error('Nessun trackId (passa trackId o imposta ERGZONE_TRACK_ID).');
      const intervals = resolveIntervals(args);
      const errors = validateIntervals(intervals);
      if (errors.length) throw new Error('Intervalli non validi: ' + errors.join('; '));

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
    description: 'Aggiorna un workout esistente (richiede id). Stessi formati intervalli di create_workout. Se non passi intervalli, aggiorna solo i metadati forniti.',
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
      if (!trackId) throw new Error('Nessun trackId.');

      // Recupera lo stato attuale per i campi non forniti.
      const cur = await gql(`query($id:ID!){ workout(id:$id){ title status publishedAt workoutType description } }`, { id: args.id });
      if (!cur.workout) throw new Error(`Workout ${args.id} non trovato.`);

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
        if (errors.length) throw new Error('Intervalli non validi: ' + errors.join('; '));
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
    description: 'Elimina un workout. Richiede confirm:true (azione irreversibile).',
    write: true,
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        confirm: { type: 'boolean', description: 'Deve essere true per procedere.' },
      },
      required: ['id'],
    },
    async handler({ id, confirm }) {
      if (confirm !== true) throw new Error('Eliminazione non confermata: passa confirm:true.');
      const d = await gql(`mutation($id:ID!){ workoutDelete(id:$id){ id title } }`, { id });
      return { deleted: d.workoutDelete };
    },
  },

  {
    name: 'list_my_results',
    description: 'Elenca i miei risultati in un intervallo di date (YYYY-MM-DD). Default: ultimi 30 giorni.',
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
    description: 'Dettaglio di un risultato con telemetria per intervallo (pace, SPM, watt, HR, force).',
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
      if (!d.workoutResult) throw new Error(`Risultato ${id} non trovato.`);
      return d.workoutResult;
    },
  },

  {
    name: 'my_stats',
    description: 'Statistiche aggregate (distanza/tempo/calorie/giorni + zone HR) su un periodo. time: "week"|"month"|"year"|"all".',
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
      'Analisi coaching di un risultato: per ogni intervallo calcola pace, SPI (watt/SPM), %HR e zona. Usa maxHr passato o quello del profilo.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        maxHr: { type: 'number', description: 'HR max per le zone (default: profilo utente)' },
      },
      required: ['id'],
    },
    async handler({ id, maxHr }) {
      const d = await gql(
        `query($id:ID!){ workoutResult(id:$id){ id elapsedTime elapsedDistance workout{ title } intervals{ ${INTERVAL_RESULT} } } }`,
        { id },
      );
      const r = d.workoutResult;
      if (!r) throw new Error(`Risultato ${id} non trovato.`);

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
