export type SignalDirection = 'RISE' | 'FALL';
export type SignalMode = 'CLASSIC' | 'PRO' | 'AI';

export interface SignalDuration {
  value: number;
  unit: 't' | 'm' | 'h';
  label: string;
  seconds: number;
}

export interface SignalModeRecommendation {
  mode: SignalMode;
  direction: SignalDirection;
  confidence: number;
  duration: SignalDuration;
  sourceSignalId: string;
  rationale: string;
}

export interface SignalConsensus {
  direction: SignalDirection | 'WAIT';
  confidence: number;
  agreement: number;
  totalEngines: number;
  recommendedDuration: SignalDuration;
  expiresAt: number;
  expiresInSeconds: number;
  status: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'WAIT';
  modeRecommendations: SignalModeRecommendation[];
}

export function durationToSeconds(value: number, unit: 't' | 'm' | 'h'): number {
  if (unit === 'm') return Math.max(1, value * 60);
  if (unit === 'h') return Math.max(1, value * 3600);
  return Math.max(1, value);
}

export function createDuration(value: number, unit: 't' | 'm' | 'h', label: string): SignalDuration {
  return { value, unit, label, seconds: durationToSeconds(value, unit) };
}

export function getSignalStatus(expiresAt: number, now = Date.now()): SignalConsensus['status'] {
  const remaining = Math.max(0, expiresAt - now);
  if (remaining <= 0) return 'EXPIRED';
  if (remaining <= 10_000) return 'EXPIRING';
  return 'ACTIVE';
}

export function buildConsensus(
  signals: Array<{
    id: string;
    direction: SignalDirection;
    confidence: number;
    recommendedDurationValue: number;
    recommendedDurationUnit: 't' | 'm' | 'h';
    recommendedDurationLabel: string;
  }>,
  now = Date.now(),
): SignalConsensus {
  if (!signals.length) {
    return {
      direction: 'WAIT', confidence: 0, agreement: 0, totalEngines: 0,
      recommendedDuration: createDuration(5, 't', '5 Ticks'), expiresAt: now,
      expiresInSeconds: 0, status: 'WAIT', modeRecommendations: [],
    };
  }

  const rise = signals.filter((s) => s.direction === 'RISE');
  const fall = signals.filter((s) => s.direction === 'FALL');
  const winner = rise.length >= fall.length ? 'RISE' : 'FALL';
  const aligned = winner === 'RISE' ? rise : fall;
  const agreement = aligned.length / signals.length;
  const confidence = aligned.length ? aligned.reduce((sum, signal) => sum + signal.confidence, 0) / aligned.length : 0;

  const durationVotes = new Map<string, { count: number; confidence: number; sample: (typeof signals)[number] }>();
  for (const signal of aligned) {
    const key = `${signal.recommendedDurationValue}${signal.recommendedDurationUnit}`;
    const existing = durationVotes.get(key);
    if (existing) {
      existing.count += 1;
      existing.confidence += signal.confidence;
    } else {
      durationVotes.set(key, { count: 1, confidence: signal.confidence, sample: signal });
    }
  }
  const durationWinner = [...durationVotes.values()].sort((a, b) => b.count - a.count || b.confidence - a.confidence)[0];
  const duration = createDuration(durationWinner.sample.recommendedDurationValue, durationWinner.sample.recommendedDurationUnit, durationWinner.sample.recommendedDurationLabel);
  const expiresAt = now + duration.seconds * 1000;

  return {
    direction: agreement >= 0.5 ? winner : 'WAIT',
    confidence: Number(confidence.toFixed(1)),
    agreement: Number((agreement * 100).toFixed(1)),
    totalEngines: signals.length,
    recommendedDuration: duration,
    expiresAt,
    expiresInSeconds: duration.seconds,
    status: getSignalStatus(expiresAt, now),
    modeRecommendations: [],
  };
}

export function buildModeRecommendations(
  signals: Array<{
    id: string;
    direction: SignalDirection;
    confidence: number;
    recommendedDurationValue: number;
    recommendedDurationUnit: 't' | 'm' | 'h';
    recommendedDurationLabel: string;
  }>,
): SignalModeRecommendation[] {
  const byPart = (part: string) => signals.find((s) => s.id.includes(`sig-${part}-`));
  const xgb = byPart('xgb');
  const trend = byPart('trend');
  const vol = byPart('vol');
  const sent = byPart('sent');
  const make = (mode: SignalMode, signal: typeof xgb, rationale: string): SignalModeRecommendation | null => signal ? {
    mode,
    direction: signal.direction,
    confidence: signal.confidence,
    duration: createDuration(signal.recommendedDurationValue, signal.recommendedDurationUnit, signal.recommendedDurationLabel),
    sourceSignalId: signal.id,
    rationale,
  } : null;
  return [
    make('CLASSIC', sent ?? trend, 'Tick direction and short-horizon flow recommendation.'),
    make('PRO', trend ?? vol, 'Regime, velocity and multi-horizon recommendation.'),
    make('AI', xgb ?? vol, 'Machine-learning recommendation from the neural prediction layer.'),
  ].filter((item): item is SignalModeRecommendation => Boolean(item));
}
