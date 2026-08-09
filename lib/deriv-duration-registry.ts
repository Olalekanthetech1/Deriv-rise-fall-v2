import WebSocket from 'ws';
import { openDerivPublicWebSocket } from './deriv-public-websocket';

export type DerivDurationUnit = 't' | 's' | 'm' | 'h' | 'd';
export type DerivDurationRange = { id: string; unit: DerivDurationUnit; min: number; max: number; tradeTypes: string[]; source: 'deriv-proposal-probe' };
export type DerivDurationDiscovery = { symbol: string; ranges: DerivDurationRange[]; fetchedAt: string; source: 'deriv-proposal-probe' };
type RecordLike = Record<string, unknown>;

const UNITS: DerivDurationUnit[] = ['t', 's', 'm', 'h', 'd'];
const UNIT_ALIASES: Record<string, DerivDurationUnit> = { t: 't', tick: 't', ticks: 't', s: 's', second: 's', seconds: 's', m: 'm', minute: 'm', minutes: 'm', h: 'h', hour: 'h', hours: 'h', d: 'd', day: 'd', days: 'd' };
const MAX_PROBE: Record<DerivDurationUnit, number> = { t: 1000, s: 86400, m: 1440, h: 168, d: 365 };
const SEED_VALUES: Record<DerivDurationUnit, number[]> = {
  t: [1],
  s: [1, 5, 10, 30, 60, 300, 900, 1800, 3600, 14400, 43200, 86400],
  m: [1, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440],
  h: [1, 2, 4, 6, 12, 24, 48, 72, 120, 168],
  d: [1, 2, 3, 7, 14, 30, 60, 90, 180, 365],
};

function asRecord(value: unknown): RecordLike | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : null; }
function isRiseFall(value: unknown): boolean { const t = String(value ?? '').trim().toUpperCase(); return ['CALL', 'PUT', 'CALLE', 'PUTE', 'RISE', 'FALL'].includes(t); }
function normalizeUnit(value: unknown): DerivDurationUnit | null { return UNIT_ALIASES[String(value ?? '').trim().toLowerCase()] ?? null; }

async function requestDeriv(symbol: string, request: RecordLike, expected: string, timeoutMs = 10000): Promise<RecordLike> {
  const ws = await openDerivPublicWebSocket(timeoutMs);
  return new Promise((resolve, reject) => {
    let done = false;
    const reqId = Math.floor(Math.random() * 2_000_000_000);
    const finish = (fn: (value: any) => void, value: any) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} fn(value); };
    const timer = setTimeout(() => finish(reject, new Error(`Deriv ${expected} discovery timed out for ${symbol}.`)), timeoutMs);
    try { ws.send(JSON.stringify({ ...request, req_id: reqId })); } catch (e) { finish(reject, e instanceof Error ? e : new Error(`Unable to request Deriv ${expected}.`)); return; }
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString()) as RecordLike;
        const error = asRecord(response.error);
        if (error) { finish(reject, new Error(`Deriv ${expected} discovery failed${error?.code ? ` (${String(error.code)})` : ''}: ${String(error?.message || 'Unknown Deriv error')}`)); return; }
        if (response.msg_type === expected) finish(resolve, response);
      } catch (e) { finish(reject, e instanceof Error ? e : new Error(`Invalid Deriv ${expected} response.`)); }
    });
    ws.on('error', e => finish(reject, e instanceof Error ? e : new Error(`Deriv ${expected} WebSocket error.`)));
    ws.on('close', () => { if (!done) finish(reject, new Error(`Deriv ${expected} connection closed before data was received for ${symbol}.`)); });
  });
}

function contractTypes(response: RecordLike): string[] {
  const available = asRecord(response.contracts_for)?.available;
  if (!Array.isArray(available)) return [];
  return Array.from(new Set(available.map(asRecord).filter(Boolean).map(c => String(c!.contract_type ?? c!.trade_type ?? '')).filter(isRiseFall).map(String)));
}

async function probeProposal(symbol: string, contractType: string, value: number, unit: DerivDurationUnit): Promise<boolean> {
  try {
    await requestDeriv(symbol, {
      proposal: 1,
      amount: 1,
      basis: 'stake',
      contract_type: contractType,
      currency: process.env.DERIV_DISCOVERY_CURRENCY?.trim().toUpperCase() || 'USD',
      duration: value,
      duration_unit: unit,
      underlying_symbol: symbol,
    }, 'proposal', 8000);
    return true;
  } catch {
    return false;
  }
}

async function discoverUnit(symbol: string, contractType: string, unit: DerivDurationUnit): Promise<{ min: number; max: number } | null> {
  const candidates = SEED_VALUES[unit].filter(v => v <= MAX_PROBE[unit]);
  const valid: number[] = [];
  for (const value of candidates) if (await probeProposal(symbol, contractType, value, unit)) valid.push(value);
  if (!valid.length) return null;

  const seed = Math.min(...valid);
  let min = seed;
  for (let v = Math.max(1, Math.floor(seed / 2)); v >= 1; v = Math.floor(v / 2)) {
    if (await probeProposal(symbol, contractType, v, unit)) min = v;
    if (v === 1) break;
  }

  let low = Math.max(seed, min), high = low;
  while (high < MAX_PROBE[unit]) {
    const next = Math.min(MAX_PROBE[unit], high * 2);
    if (next === high || !(await probeProposal(symbol, contractType, next, unit))) break;
    high = next;
  }
  if (high > low) {
    let lo = high, hi = Math.min(MAX_PROBE[unit], high * 2);
    if (hi > high && await probeProposal(symbol, contractType, hi, unit)) { low = high; high = hi; }
    let left = low, right = high;
    while (left + 1 < right) {
      const mid = Math.floor((left + right) / 2);
      if (await probeProposal(symbol, contractType, mid, unit)) left = mid; else right = mid;
    }
    high = left;
  }
  return { min, max: high };
}

export async function getDerivDurationDiscovery(symbol: string): Promise<DerivDurationDiscovery> {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) throw new Error('A Deriv symbol is required for duration discovery.');

  const contracts = await requestDeriv(normalized, { contracts_for: normalized }, 'contracts_for');
  const types = contractTypes(contracts);
  if (!types.length) throw new Error(`Deriv returned no Rise/Fall contract types for ${normalized}.`);

  const ranges: DerivDurationRange[] = [];
  for (const contractType of types.slice(0, 2)) {
    for (const unit of UNITS) {
      const discovered = await discoverUnit(normalized, contractType, unit);
      if (discovered) ranges.push({ id: `${normalized}:${contractType}:${unit}:${discovered.min}-${discovered.max}`, unit, min: discovered.min, max: discovered.max, tradeTypes: [contractType], source: 'deriv-proposal-probe' });
    }
  }

  const merged = new Map<string, DerivDurationRange>();
  for (const range of ranges) {
    const key = `${range.unit}:${range.min}:${range.max}`;
    const existing = merged.get(key);
    if (existing) existing.tradeTypes = Array.from(new Set([...existing.tradeTypes, ...range.tradeTypes])).sort();
    else merged.set(key, { ...range });
  }
  const ordered = Array.from(merged.values()).sort((a, b) => UNITS.indexOf(a.unit) - UNITS.indexOf(b.unit) || a.min - b.min || a.max - b.max);
  if (!ordered.length) throw new Error(`Deriv proposal capability probing found no supported Rise/Fall durations for ${normalized}.`);

  return { symbol: normalized, ranges: ordered, fetchedAt: new Date().toISOString(), source: 'deriv-proposal-probe' };
}

export function durationToSeconds(value: number, unit: DerivDurationUnit): number | null { if (!Number.isSafeInteger(value) || value <= 0) return null; if (unit === 't') return null; return value * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<Exclude<DerivDurationUnit, 't'>, number>)[unit]; }
export function durationLabel(value: number, unit: DerivDurationUnit): string { return `${value} ${{ t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }[unit]}`; }
export function durationRangeLabel(range: DerivDurationRange): string { return range.min === range.max ? durationLabel(range.min, range.unit) : `${durationLabel(range.min, range.unit)} – ${durationLabel(range.max, range.unit)}`; }
export function expandTrainingDurations(ranges: DerivDurationRange[], maxExpandedPerRange = 128): Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> {
  const result: Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> = [];
  for (const range of ranges) {
    const span = range.max - range.min;
    if (span <= maxExpandedPerRange) for (let value = range.min; value <= range.max; value += 1) result.push({ value, unit: range.unit, rangeId: range.id });
    else { result.push({ value: range.min, unit: range.unit, rangeId: range.id }); result.push({ value: range.max, unit: range.unit, rangeId: range.id }); }
  }
  const seen = new Set<string>();
  return result.filter(item => { const key = `${item.value}:${item.unit}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
