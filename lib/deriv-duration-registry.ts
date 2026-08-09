import WebSocket from 'ws';
import { openDerivPublicWebSocket } from './deriv-public-websocket';

export type DerivDurationUnit = 't' | 's' | 'm' | 'h' | 'd';
export type DerivDurationRange = { id: string; unit: DerivDurationUnit; min: number; max: number; tradeTypes: string[]; source: 'deriv-trading-durations' | 'deriv-contracts-for' };
export type DerivDurationDiscovery = { symbol: string; ranges: DerivDurationRange[]; fetchedAt: string; source: 'deriv-trading-durations' | 'deriv-contracts-for' };
type UnknownRecord = Record<string, unknown>;

const UNIT_SECONDS: Record<DerivDurationUnit, number> = { t: 0, s: 1, m: 60, h: 3600, d: 86400 };

function asRecord(value: unknown): UnknownRecord | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null; }
function normalizeUnit(value: unknown): DerivDurationUnit | null { const unit = String(value ?? '').trim().toLowerCase(); return unit === 't' || unit === 's' || unit === 'm' || unit === 'h' || unit === 'd' ? unit : null; }
function parseDurationToken(value: unknown, fallbackUnit: DerivDurationUnit | null = null): { value: number; unit: DerivDurationUnit } | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && fallbackUnit) return { value, unit: fallbackUnit };
  const text = String(value ?? '').trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([tsmhd])$/);
  if (!match) return null;
  const parsed = Number(match[1]); const unit = normalizeUnit(match[2]);
  return unit && Number.isSafeInteger(parsed) && parsed > 0 ? { value: parsed, unit } : null;
}
function parseBoundary(record: UnknownRecord, names: string[], fallbackUnit: DerivDurationUnit | null) { for (const name of names) { const parsed = parseDurationToken(record[name], fallbackUnit); if (parsed) return parsed; } return null; }

function mergeRanges(ranges: DerivDurationRange[]): DerivDurationRange[] {
  const merged = new Map<string, DerivDurationRange>();
  for (const range of ranges) {
    const key = `${range.unit}:${range.min}:${range.max}`;
    const existing = merged.get(key);
    if (existing) {
      existing.tradeTypes = Array.from(new Set([...existing.tradeTypes, ...range.tradeTypes])).sort();
      existing.source = existing.source === range.source ? existing.source : 'deriv-trading-durations';
    } else merged.set(key, { ...range });
  }
  const unitOrder = ['t', 's', 'm', 'h', 'd'];
  return Array.from(merged.values()).sort((a, b) => unitOrder.indexOf(a.unit) - unitOrder.indexOf(b.unit) || a.min - b.min || a.max - b.max);
}

function collectTradeDurationNodes(value: unknown, symbol: string, inheritedSymbol = ''): Array<{ durations: unknown[]; tradeType: string }> {
  const record = asRecord(value);
  if (!record) return Array.isArray(value) ? value.flatMap((item) => collectTradeDurationNodes(item, symbol, inheritedSymbol)) : [];
  let currentSymbol = inheritedSymbol;
  const directSymbol = typeof record.symbol === 'string' ? record.symbol : typeof record.underlying_symbol === 'string' ? record.underlying_symbol : '';
  if (directSymbol) currentSymbol = directSymbol;
  if (Array.isArray(record.symbol) && Array.isArray(record.trade_durations)) {
    const matches = record.symbol.some((item) => {
      const itemRecord = asRecord(item);
      const itemSymbol = typeof itemRecord?.symbol === 'string' ? itemRecord.symbol : typeof itemRecord?.underlying_symbol === 'string' ? itemRecord.underlying_symbol : '';
      return itemSymbol.toUpperCase() === symbol.toUpperCase();
    });
    if (matches) return record.trade_durations.flatMap((tradeDuration) => { const trade = asRecord(tradeDuration); return trade && Array.isArray(trade.durations) ? [{ durations: trade.durations, tradeType: String(trade.trade_type ?? '') }] : []; });
  }
  if (currentSymbol.toUpperCase() === symbol.toUpperCase() && Array.isArray(record.trade_durations)) {
    return record.trade_durations.flatMap((tradeDuration) => { const trade = asRecord(tradeDuration); return trade && Array.isArray(trade.durations) ? [{ durations: trade.durations, tradeType: String(trade.trade_type ?? '') }] : []; });
  }
  return Object.values(record).flatMap((child) => collectTradeDurationNodes(child, symbol, currentSymbol));
}

function parseTradingDurations(response: UnknownRecord, symbol: string): DerivDurationRange[] {
  const ranges: DerivDurationRange[] = [];
  for (const node of collectTradeDurationNodes(response.trading_durations, symbol)) {
    for (const rawDuration of node.durations) {
      const duration = asRecord(rawDuration); if (!duration) continue;
      const explicitUnit = normalizeUnit(duration.unit ?? duration.duration_unit ?? duration.units);
      const min = parseBoundary(duration, ['min', 'minimum', 'min_duration', 'min_contract_duration'], explicitUnit);
      const max = parseBoundary(duration, ['max', 'maximum', 'max_duration', 'max_contract_duration'], explicitUnit);
      if (!min || !max) continue;
      const unit = explicitUnit ?? min.unit;
      if (min.unit !== unit || max.unit !== unit || max.value < min.value) continue;
      ranges.push({ id: `${symbol}:${node.tradeType || 'unknown'}:${unit}:${min.value}-${max.value}`, unit, min: min.value, max: max.value, tradeTypes: node.tradeType ? [node.tradeType] : [], source: 'deriv-trading-durations' });
    }
  }
  return mergeRanges(ranges);
}

function parseContractsFor(response: UnknownRecord, symbol: string): DerivDurationRange[] {
  const contractsFor = asRecord(response.contracts_for);
  const available = Array.isArray(contractsFor?.available) ? contractsFor.available : [];
  const ranges: DerivDurationRange[] = [];
  for (const rawItem of available) {
    const item = asRecord(rawItem); if (!item) continue;
    const min = parseDurationToken(item.min_contract_duration);
    const max = parseDurationToken(item.max_contract_duration);
    if (!min || !max || min.unit !== max.unit || max.value < min.value) continue;
    ranges.push({ id: `${symbol}:${String(item.contract_type ?? 'unknown')}:${min.unit}:${min.value}-${max.value}`, unit: min.unit, min: min.value, max: max.value, tradeTypes: item.contract_type ? [String(item.contract_type)] : [], source: 'deriv-contracts-for' });
  }
  return mergeRanges(ranges);
}

async function requestDeriv(symbol: string, request: UnknownRecord, expectedMsgType: string, timeoutMs: number): Promise<UnknownRecord> {
  const ws = await openDerivPublicWebSocket(timeoutMs);
  return new Promise((resolve, reject) => {
    let handled = false;
    const reqId = Date.now() % 2_000_000_000;
    const timeout = setTimeout(() => { if (!handled) { handled = true; try { ws.close(); } catch {} reject(new Error(`Deriv ${expectedMsgType} discovery timed out for ${symbol}.`)); } }, timeoutMs);
    const fail = (error: Error) => { if (handled) return; handled = true; clearTimeout(timeout); try { ws.close(); } catch {} reject(error); };
    ws.send(JSON.stringify({ ...request, req_id: reqId }));
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString()) as UnknownRecord;
        if (response.error) { const error = asRecord(response.error); fail(new Error(`Deriv ${expectedMsgType} discovery failed${error?.code ? ` (${String(error.code)})` : ''}: ${String(error?.message || 'Unknown Deriv error')}`)); return; }
        if (response.msg_type !== expectedMsgType) return;
        handled = true; clearTimeout(timeout); try { ws.close(); } catch {} resolve(response);
      } catch (error) { fail(error instanceof Error ? error : new Error(`Invalid Deriv ${expectedMsgType} response.`)); }
    });
    ws.on('error', (error) => fail(error instanceof Error ? error : new Error(`Deriv ${expectedMsgType} WebSocket error.`)));
    ws.on('close', () => { if (!handled) fail(new Error(`Deriv ${expectedMsgType} connection closed before data was received for ${symbol}.`)); });
  });
}

export async function getDerivDurationDiscovery(symbol: string): Promise<DerivDurationDiscovery> {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) throw new Error('A Deriv symbol is required for duration discovery.');

  try {
    const response = await requestDeriv(normalized, { trading_durations: 1 }, 'trading_durations', 10_000);
    const ranges = parseTradingDurations(response, normalized);
    if (ranges.length) return { symbol: normalized, ranges, fetchedAt: new Date().toISOString(), source: 'deriv-trading-durations' };
  } catch {}

  const response = await requestDeriv(normalized, { contracts_for: normalized }, 'contracts_for', 10_000);
  const ranges = parseContractsFor(response, normalized);
  if (!ranges.length) throw new Error(`Deriv returned no supported trading-duration ranges for ${normalized}.`);
  return { symbol: normalized, ranges, fetchedAt: new Date().toISOString(), source: 'deriv-contracts-for' };
}

export function durationToSeconds(value: number, unit: DerivDurationUnit): number | null { return Number.isSafeInteger(value) && value > 0 && unit !== 't' ? value * UNIT_SECONDS[unit] : null; }
export function durationLabel(value: number, unit: DerivDurationUnit): string { return `${value} ${{ t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }[unit]}`; }
export function durationRangeLabel(range: DerivDurationRange): string { return range.min === range.max ? durationLabel(range.min, range.unit) : `${durationLabel(range.min, range.unit)} – ${durationLabel(range.max, range.unit)}`; }
export function expandTrainingDurations(ranges: DerivDurationRange[], maxExpandedPerRange = 128): Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> {
  const result: Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> = [];
  for (const range of ranges) {
    const span = range.max - range.min;
    if (span <= maxExpandedPerRange) for (let value = range.min; value <= range.max; value += 1) result.push({ value, unit: range.unit, rangeId: range.id });
    else { result.push({ value: range.min, unit: range.unit, rangeId: range.id }); if (range.max !== range.min) result.push({ value: range.max, unit: range.unit, rangeId: range.id }); }
  }
  const seen = new Set<string>();
  return result.filter((item) => { const key = `${item.value}:${item.unit}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
