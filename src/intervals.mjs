// Builder e validazione intervalli ErgZone.
// Nasconde la complessita' dei campi "suggested*" (intensity / target pace relativo):
//   - suggestedPaceBenchmarkGroup: "INTERVAL" (rif. altro intervallo) | "A"/"B"... (benchmark PR)
//   - suggestedInterval: indice 0-based dell'intervallo di riferimento (< posizione corrente)
//   - suggestedOperator: SOLO "+" (il segno va nel pace)
//   - suggestedPace: offset sec/500m (negativo = piu' veloce)

// "M:SS" oppure secondi (numero/stringa) => secondi interi.
export function parseDuration(v) {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') {
    const s = v.trim();
    const m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  }
  throw new Error(`Durata non valida: ${JSON.stringify(v)} (usa "M:SS" o secondi)`);
}

// Un "segment" alto livello -> IntervalInput GraphQL.
// Campi segment:
//   time | work : durata ("M:SS"/sec)         (default se nessun distance/cals)
//   distance    : metri                        -> type "distance"
//   cals        : calorie                      -> type "cals"
//   spm, spmMax : cadenza target
//   rest        : rest dopo l'intervallo ("M:SS"/sec)
//   undefRest   : bool (rest libero)
//   notes, restNotes
//   fasterThanPrev : N  -> N sec/500m piu' veloce dell'intervallo precedente
//   fasterThan     : { interval: <1-based>, seconds: N }  -> rispetto a un intervallo specifico
//   benchmark      : { group: "A", offset: N }  -> rispetto a un benchmark PR (offset firmato)
function segmentToInterval(seg, idx) {
  const iv = { undefRest: !!seg.undefRest };

  if (seg.distance != null) {
    iv.type = 'distance';
    iv.value = Math.round(seg.distance);
  } else if (seg.cals != null) {
    iv.type = 'cals';
    iv.value = Math.round(seg.cals);
  } else {
    iv.type = 'time';
    iv.value = parseDuration(seg.time ?? seg.work);
  }

  if (seg.spm != null) iv.spm = seg.spm;
  if (seg.spmMax != null) iv.spmMax = seg.spmMax;
  if (seg.rest != null) iv.rest = parseDuration(seg.rest);
  if (seg.notes) iv.notes = seg.notes;
  if (seg.restNotes) iv.restNotes = seg.restNotes;

  // Intensity
  if (seg.fasterThanPrev != null) {
    if (idx === 0) throw new Error('fasterThanPrev non valido sul primo intervallo (nessun precedente)');
    iv.suggestedPaceBenchmarkGroup = 'INTERVAL';
    iv.suggestedInterval = idx - 1;
    iv.suggestedOperator = '+';
    iv.suggestedPace = -Math.abs(seg.fasterThanPrev);
  } else if (seg.fasterThan) {
    const ref0 = Number(seg.fasterThan.interval) - 1; // 1-based umano -> 0-based
    if (!(ref0 >= 0) || ref0 >= idx) {
      throw new Error(`fasterThan.interval deve riferirsi a un intervallo precedente (1..${idx})`);
    }
    iv.suggestedPaceBenchmarkGroup = 'INTERVAL';
    iv.suggestedInterval = ref0;
    iv.suggestedOperator = '+';
    iv.suggestedPace = -Math.abs(seg.fasterThan.seconds);
  } else if (seg.benchmark) {
    iv.suggestedPaceBenchmarkGroup = String(seg.benchmark.group);
    iv.suggestedOperator = '+';
    iv.suggestedPace = Number(seg.benchmark.offset);
  }

  return iv;
}

export function buildIntervals(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('segments vuoto o non valido');
  }
  return segments.map((s, i) => segmentToInterval(s, i));
}

// --- Ricette alto livello ---

// SPM ladder: es. ladder({spmStart:16, spmEnd:30}) -> 16/17, 18/19, ... 30/31, ognuno 1' rest 20s.
export function ladder({
  spmStart = 16,
  spmEnd = 30,
  step = 2,
  pairWidth = 1,
  work = '1:00',
  rest = '0:20',
  lastRest = false,
} = {}) {
  const segs = [];
  for (let s = spmStart; s <= spmEnd; s += step) {
    const seg = { time: work, spm: s, rest };
    if (pairWidth) seg.spmMax = s + pairWidth;
    segs.push(seg);
  }
  if (!lastRest && segs.length) delete segs[segs.length - 1].rest;
  return buildIntervals(segs);
}

// Over/under: blocchi base + surge. blocks:[{baseWork,baseSpm,surgeWork,surgeSpm}].
export function overUnder({ blocks = [], restBetween = '1:00' } = {}) {
  if (!blocks.length) throw new Error('overUnder: blocks vuoto');
  const segs = [];
  blocks.forEach((b, i) => {
    segs.push({ time: b.baseWork, spm: b.baseSpm });
    const surge = { time: b.surgeWork, spm: b.surgeSpm };
    if (i < blocks.length - 1) surge.rest = restBetween;
    segs.push(surge);
  });
  return buildIntervals(segs);
}

// Progressivo intensity: ogni blocco ripete un pattern di durate; il primo intervallo
// di ogni blocco e' "libero" (nessun target), gli altri -faster sec/500m sul precedente.
export function progressiveIntensity({
  pattern = ['1:00', '2:00', '1:00', '3:00', '1:00', '4:00'],
  blocks = 2,
  faster = 0.1,
  restBetween = '4:00',
  restAfterLast = false,
} = {}) {
  const segs = [];
  for (let b = 0; b < blocks; b++) {
    pattern.forEach((dur, j) => {
      const seg = { time: dur };
      if (j > 0) seg.fasterThanPrev = faster; // il primo di ogni blocco resta libero
      segs.push(seg);
    });
    const last = segs[segs.length - 1];
    if (b < blocks - 1) last.rest = restBetween;
    else if (restAfterLast) last.rest = restBetween;
  }
  return buildIntervals(segs);
}

// Validazione client-side: anticipa gli errori criptici del server.
export function validateIntervals(intervals) {
  const errs = [];
  intervals.forEach((iv, i) => {
    if (!['time', 'distance', 'cals'].includes(iv.type)) errs.push(`#${i + 1}: type non valido (${iv.type})`);
    if (!(iv.value > 0)) errs.push(`#${i + 1}: value mancante o <= 0`);
    const hasSuggest = iv.suggestedInterval != null || iv.suggestedPace != null || iv.suggestedPaceBenchmarkGroup != null;
    if (hasSuggest) {
      if (iv.suggestedOperator !== '+') errs.push(`#${i + 1}: suggestedOperator deve essere "+"`);
      if (iv.suggestedInterval != null && iv.suggestedInterval >= i) {
        errs.push(`#${i + 1}: suggestedInterval ${iv.suggestedInterval} deve essere < ${i} (0-based)`);
      }
      const g = iv.suggestedPaceBenchmarkGroup;
      if (g !== 'INTERVAL' && !/^[A-Z]$/.test(g || '')) errs.push(`#${i + 1}: benchmarkGroup non valido (${g})`);
      if (g === 'INTERVAL' && iv.suggestedInterval == null) errs.push(`#${i + 1}: group INTERVAL richiede suggestedInterval`);
    }
  });
  return errs;
}

// Risolve gli intervalli da uno dei formati accettati dai tool: intervals | segments | recipe.
export function resolveIntervals(args) {
  if (Array.isArray(args.intervals)) return args.intervals;
  if (Array.isArray(args.segments)) return buildIntervals(args.segments);
  if (args.recipe && args.recipe.kind) {
    const { kind, ...params } = args.recipe;
    switch (kind) {
      case 'ladder':
        return ladder(params);
      case 'over_under':
        return overUnder(params);
      case 'progressive':
      case 'progressive_intensity':
        return progressiveIntensity(params);
      case 'custom':
        return buildIntervals(params.segments);
      default:
        throw new Error(`recipe.kind sconosciuto: ${kind}`);
    }
  }
  throw new Error('Fornisci uno tra: intervals, segments, recipe');
}
