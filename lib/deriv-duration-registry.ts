import WebSocket from 'ws';
import { openDerivPublicWebSocket } from './deriv-public-websocket';

export type DerivDurationUnit = 't' | 's' | 'm' | 'h' | 'd';
export type DerivDurationRange = { id: string; unit: DerivDurationUnit; min: number; max: number; tradeTypes: string[]; source: 'deriv-proposal-probe' };
export type DerivDurationDiscovery = { symbol: string; ranges: DerivDurationRange[]; fetchedAt: string; source: 'deriv-proposal-probe' };
type RecordLike = Record<string, unknown>;
type ContractCapability = { type: string; expiryType: string; probe: Record<string, unknown> };

const UNIT_ALIASES: Record<string, DerivDurationUnit> = {
  t: 't', tick: 't', ticks: 't', s: 's', second: 's', seconds: 's', m: 'm', minute: 'm', minutes: 'm', h: 'h', hour: 'h', hours: 'h', d: 'd', day: 'd', days: 'd',
};
const MAX_PROBE: Record<DerivDurationUnit, number> = { t: 1000, s: 86400, m: 1440, h: 168, d: 365 };
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const PROBE_INTERVAL_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 2;
const PROBEABLE_TYPES = new Set(['CALL', 'PUT', 'CALLE', 'PUTE', 'UPORDOWN', 'MULTUP', 'MULTDOWN', 'TICKHIGH', 'TICKLOW', 'RESETCALL', 'RESETPUT', 'RUNHIGH', 'RUNLOW']);
const cache = new Map<string, { value: DerivDurationDiscovery; expiresAt: number }>();
const inFlight = new Map<string, Promise<DerivDurationDiscovery>>();

function asRecord(value: unknown): RecordLike | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : null; }
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRateLimited(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); return /429|ratelimit|rate.?limit|too many requests|throttle/i.test(message); }

class DerivDiscoverySession {
  private ws: WebSocket | null = null;
  private sequence = 0;
  private lastProposalAt = 0;
  async connect(timeoutMs = 10000): Promise<void> { this.ws = await openDerivPublicWebSocket(timeoutMs); }
  close(): void { try { this.ws?.close(); } catch {} this.ws = null; }

  async request(request: RecordLike, expected: string, timeoutMs = 10000): Promise<RecordLike> {
    if (!this.ws) throw new Error('Deriv discovery session is not connected.');
    const ws = this.ws; const reqId = ++this.sequence;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn: (value: any) => void, value: any) => { if (done) return; done = true; clearTimeout(timer); ws.off('message', onMessage); fn(value); };
      const timer = setTimeout(() => finish(reject, new Error(`Deriv ${expected} discovery timed out.`)), timeoutMs);
      const onMessage = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString()) as RecordLike;
          if (Number(response.req_id) !== reqId) return;
          const error = asRecord(response.error);
          if (error) { const code = String(error.code ?? ''); finish(reject, new Error(`Deriv ${expected} discovery failed${code ? ` (${code})` : ''}: ${String(error.message ?? 'Unknown Deriv error')}`)); return; }
          if (response.msg_type === expected) finish(resolve, response);
        } catch (error) { finish(reject, error instanceof Error ? error : new Error(`Invalid Deriv ${expected} response.`)); }
      };
      ws.on('message', onMessage);
      try { ws.send(JSON.stringify({ ...request, req_id: reqId })); } catch (error) { finish(reject, error instanceof Error ? error : new Error(`Unable to request Deriv ${expected}.`)); }
    });
  }

  async proposal(symbol: string, capability: ContractCapability, value: number, unit: DerivDurationUnit): Promise<boolean> {
    const elapsed = Date.now() - this.lastProposalAt;
    if (elapsed < PROBE_INTERVAL_MS) await sleep(PROBE_INTERVAL_MS - elapsed);
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      this.lastProposalAt = Date.now();
      try {
        await this.request({ proposal: 1, amount: 1, basis: 'stake', contract_type: capability.type, currency: process.env.DERIV_DISCOVERY_CURRENCY?.trim().toUpperCase() || 'USD', duration: value, duration_unit: unit, underlying_symbol: symbol, ...capability.probe }, 'proposal', 8000);
        return true;
      } catch (error) {
        if (!isRateLimited(error) || attempt === MAX_RATE_LIMIT_RETRIES) return false;
        await sleep(1500 * 2 ** attempt);
      }
    }
    return false;
  }
}

function probeParams(type: string): Record<string, unknown> | null {
  switch (type) {
    case 'MULTUP': case 'MULTDOWN': return { multiplier: 10 };
    case 'TICKHIGH': case 'TICKLOW': return { selected_tick: 1 };
    case 'RUNHIGH': case 'RUNLOW': return { barrier: '0' };
    case 'CALL': case 'PUT': case 'CALLE': case 'PUTE': case 'UPORDOWN': case 'RESETCALL': case 'RESETPUT': return {};
    default: return null;
  }
}

function contractCapabilities(response: RecordLike): ContractCapability[] {
  const contractsFor = asRecord(response.contracts_for); const available = contractsFor?.available;
  if (!Array.isArray(available)) return [];
  const byType = new Map<string, ContractCapability>();
  for (const item of available) {
    const contract = asRecord(item); if (!contract) continue;
    const type = String(contract.contract_type ?? contract.trade_type ?? '').trim().toUpperCase();
    if (!type || !PROBEABLE_TYPES.has(type) || byType.has(type)) continue;
    const probe = probeParams(type); if (!probe) continue;
    const expiryType = String(contract.expiry_type ?? '').trim().toLowerCase();
    byType.set(type, { type, expiryType, probe });
  }
  return Array.from(byType.values());
}

function unitsForExpiryType(expiryType: string): DerivDurationUnit[] {
  switch (expiryType) {
    case 'tick': case 'ticks': return ['t'];
    case 'intraday': return ['s', 'm', 'h'];
    case 'daily': return ['h', 'd'];
    case 'endtime': return ['s', 'm', 'h', 'd'];
    default: return ['t', 's', 'm', 'h', 'd'];
  }
}

async function discoverUnit(session: DerivDiscoverySession, symbol: string, capability: ContractCapability, unit: DerivDurationUnit): Promise<{ min: number; max: number } | null> {
  const max = MAX_PROBE[unit];
  if (!(await session.proposal(symbol, capability, 1, unit))) return null;
  let validMax = 1; let invalidUpper: number | null = null;
  while (validMax < max) {
    const next = Math.min(max, validMax * 2); if (next === validMax) break;
    if (await session.proposal(symbol, capability, next, unit)) validMax = next; else { invalidUpper = next; break; }
  }
  if (invalidUpper !== null) {
    let left = validMax; let right = invalidUpper;
    while (left + 1 < right) { const mid = Math.floor((left + right) / 2); if (await session.proposal(symbol, capability, mid, unit)) left = mid; else right = mid; }
    validMax = left;
  }
  return { min: 1, max: validMax };
}

async function discover(symbol: string): Promise<DerivDurationDiscovery> {
  const session = new DerivDiscoverySession();
  try {
    await session.connect();
    const contracts = await session.request({ contracts_for: symbol }, 'contracts_for');
    const capabilities = contractCapabilities(contracts);
    if (!capabilities.length) throw new Error(`Deriv returned no duration-probeable contracts for ${symbol}.`);
    const preferred = capabilities.find(c => ['CALL', 'PUT', 'CALLE', 'PUTE', 'UPORDOWN'].includes(c.type)) ?? capabilities.find(c => ['MULTUP', 'MULTDOWN'].includes(c.type)) ?? capabilities[0];
    const ranges: DerivDurationRange[] = [];
    for (const unit of unitsForExpiryType(preferred.expiryType)) {
      const range = await discoverUnit(session, symbol, preferred, unit);
      if (range) ranges.push({ id: `${symbol}:${preferred.type}:${unit}:${range.min}-${range.max}`, unit, min: range.min, max: range.max, tradeTypes: [preferred.type], source: 'deriv-proposal-probe' });
    }
    if (!ranges.length) throw new Error(`Deriv proposal capability probing found no supported durations for ${symbol}.`);
    return { symbol, ranges, fetchedAt: new Date().toISOString(), source: 'deriv-proposal-probe' };
  } finally { session.close(); }
}

export async function getDerivDurationDiscovery(symbol: string): Promise<DerivDurationDiscovery> {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) throw new Error('A Deriv symbol is required for duration discovery.');
  const cached = cache.get(normalized); if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = inFlight.get(normalized); if (existing) return existing;
  const promise = discover(normalized).then(value => { cache.set(normalized, { value, expiresAt: Date.now() + DISCOVERY_TTL_MS }); return value; }).finally(() => { inFlight.delete(normalized); });
  inFlight.set(normalized, promise); return promise;
}

export function durationToSeconds(value: number, unit: DerivDurationUnit): number | null {
  if (!Number.isSafeInteger(value) || value <= 0 || unit === 't') return null;
  return value * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<Exclude<DerivDurationUnit, 't'>, number>)[unit];
}
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
