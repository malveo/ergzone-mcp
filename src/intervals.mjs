// Interval builder and validation for ErgZone.
// Hides the complexity of the "suggested*" fields (intensity / relative target pace):
//   - suggestedPaceBenchmarkGroup: "INTERVAL" (ref another interval) | "A"/"B"... (PR benchmark)
//   - suggestedInterval: 0-based index of the referenced interval (< current position)
//   - suggestedOperator: ONLY "+" (the sign goes into the pace)
//   - suggestedPace: offset sec/500m (negative = faster)

// "M:SS" or seconds (number/string) => integer seconds.
export function parseDuration(v) {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') {
    const s = v.trim();
    const m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  }
  throw new Error(`Invalid duration: ${JSON.stringify(v)} (use "M:SS" or seconds)`);
}

// A high-level "segment" -> GraphQL IntervalInput.
// Segment fields:
//   time | work : duration ("M:SS"/sec)        (default if no distance/cals)
//   distance    : meters                        -> type "distance"
//   cals        : calories                      -> type "cals"
//   spm, spmMax : target stroke rate
//   rest        : rest after the interval ("M:SS"/sec)
//   undefRest   : bool (open/undefined rest)
//   notes, restNotes
//   fasterThanPrev : N  -> N sec/500m faster than the previous interval
//   fasterThan     : { interval: <1-based>, seconds: N }  -> relative to a specific interval
//   benchmark      : { group: "A", offset: N }  -> relative to a PR benchmark (signed offset)
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
    if (idx === 0) throw new Error('fasterThanPrev is invalid on the first interval (no previous one)');
    iv.suggestedPaceBenchmarkGroup = 'INTERVAL';
    iv.suggestedInterval = idx - 1;
    iv.suggestedOperator = '+';
    iv.suggestedPace = -Math.abs(seg.fasterThanPrev);
  } else if (seg.fasterThan) {
    const ref0 = Number(seg.fasterThan.interval) - 1; // 1-based human -> 0-based
    if (!(ref0 >= 0) || ref0 >= idx) {
      throw new Error(`fasterThan.interval must reference a previous interval (1..${idx})`);
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
    throw new Error('segments is empty or invalid');
  }
  return segments.map((s, i) => segmentToInterval(s, i));
}

// --- High-level recipes ---

// SPM ladder: e.g. ladder({spmStart:16, spmEnd:30}) -> 16/17, 18/19, ... 30/31, each 1' rest 20s.
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

// Over/under: base + surge blocks. blocks:[{baseWork,baseSpm,surgeWork,surgeSpm}].
export function overUnder({ blocks = [], restBetween = '1:00' } = {}) {
  if (!blocks.length) throw new Error('overUnder: blocks is empty');
  const segs = [];
  blocks.forEach((b, i) => {
    segs.push({ time: b.baseWork, spm: b.baseSpm });
    const surge = { time: b.surgeWork, spm: b.surgeSpm };
    if (i < blocks.length - 1) surge.rest = restBetween;
    segs.push(surge);
  });
  return buildIntervals(segs);
}

// Progressive intensity: each block repeats a pattern of durations; the first interval
// of every block is "free" (no target), the others are -faster sec/500m vs the previous one.
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
      if (j > 0) seg.fasterThanPrev = faster; // the first interval of each block stays free
      segs.push(seg);
    });
    const last = segs[segs.length - 1];
    if (b < blocks - 1) last.rest = restBetween;
    else if (restAfterLast) last.rest = restBetween;
  }
  return buildIntervals(segs);
}

// Client-side validation: anticipates the server's cryptic errors.
export function validateIntervals(intervals) {
  const errs = [];
  intervals.forEach((iv, i) => {
    if (!['time', 'distance', 'cals'].includes(iv.type)) errs.push(`#${i + 1}: invalid type (${iv.type})`);
    if (!(iv.value > 0)) errs.push(`#${i + 1}: missing or <= 0 value`);
    const hasSuggest = iv.suggestedInterval != null || iv.suggestedPace != null || iv.suggestedPaceBenchmarkGroup != null;
    if (hasSuggest) {
      if (iv.suggestedOperator !== '+') errs.push(`#${i + 1}: suggestedOperator must be "+"`);
      if (iv.suggestedInterval != null && iv.suggestedInterval >= i) {
        errs.push(`#${i + 1}: suggestedInterval ${iv.suggestedInterval} must be < ${i} (0-based)`);
      }
      const g = iv.suggestedPaceBenchmarkGroup;
      if (g !== 'INTERVAL' && !/^[A-Z]$/.test(g || '')) errs.push(`#${i + 1}: invalid benchmarkGroup (${g})`);
      if (g === 'INTERVAL' && iv.suggestedInterval == null) errs.push(`#${i + 1}: group INTERVAL requires suggestedInterval`);
    }
  });
  return errs;
}

// Resolves intervals from one of the formats accepted by the tools: intervals | segments | recipe.
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
        throw new Error(`Unknown recipe.kind: ${kind}`);
    }
  }
  throw new Error('Provide one of: intervals, segments, recipe');
}
