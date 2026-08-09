import WebSocket from 'ws';
import { openDerivPublicWebSocket } from './deriv-public-websocket';

export type DerivDurationUnit = 't' | 's' | 'm' | 'h' | 'd';

export type DerivDurationRange = {
  id: string;
  unit: DerivDurationUnit;
  min: number;
  max: number;
  tradeTypes: string[];
  source: 'deriv-trading-durations';
};

export type DerivDurationDiscovery = {
  symbol: string;
  ranges: DerivDurationRange[];
  fetchedAt: string;
  source: 'deriv-trading-durations';
};

type UnknownRecord = Record<string, unknown>;

const UNIT_SECONDS: Record<DerivDurationUnit, number> = {
  t: 0,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function normalizeUnit(value: unknown): DerivDurationUnit | null {
  const unit = String(value ?? '').trim().toLowerCase();
  return unit === 't' || unit === 's' || unit === 'm' || unit === 'h' || unit === 'd' ? unit : null;
}

function parseDurationToken(value: unknown): { value: number; unit: DerivDurationUnit } | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return { value, unit: 's' };
  const text = String(value ?? '').trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([tsmhd])$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  const unit = normalizeUnit(match[2]);
  if (!unit || !Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(parsed)) return null;
  return { value: parsed, unit };
}

function parseBoundary(record: UnknownRecord, names: string[], fallbackUnit: DerivDurationUnit | null): { value: number; unit: DerivDurationUnit } | null {
  for (const name of names) {
    const parsed = parseDurationToken(record[name]);
    if (parsed) return parsed;
  }
  return null;
}

function collectTradeDurationNodes(value: unknown, symbol: string, inheritedSymbol = ''): Array<{ durations: unknown[]; tradeType: string }> {
  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) return value.flatMap((item) => collectTradeDurationNodes(item, symbol, inheritedSymbol));
    return [];
  }

  let currentSymbol = inheritedSymbol;
  const directSymbol = typeof record.symbol === 'string' ? record.symbol : typeof record.underlying_symbol === 'string' ? record.underlying_symbol : '';
  if (directSymbol) currentSymbol = directSymbol;

  if (Array.isArray(record.symbol)) {
    for (const item of record.symbol) {
      const itemRecord = asRecord(item);
      const itemSymbol = typeof itemRecord?.symbol === 'string'
        ? itemRecord.symbol
        : typeof itemRecord?.underlying_symbol === 'string'
          ? itemRecord.underlying_symbol
          : '';
      if (itemSymbol === symbol && Array.isArray(record.trade_durations)) {
        return record.trade_durations.flatMap((tradeDuration) => {
          const trade = asRecord(tradeDuration);
          if (!trade || !Array.isArray(trade.durations)) return [];
          return [{ durations: trade.durations, tradeType: String(trade.trade_type ?? '') }];
        });
      }
    }
  }

  const matchesSymbol = currentSymbol.toUpperCase() === symbol.toUpperCase();
  if (matchesSymbol && Array.isArray(record.trade_durations)) {
    return record.trade_durations.flatMap((tradeDuration) => {
      const trade = asRecord(tradeDuration);
      if (!trade || !Array.isArray(trade.durations)) return [];
      return [{ durations: trade.durations, tradeType: String(trade.trade_type ?? '') }];
    });
  }

  return Object.values(record).flatMap((child) => collectTradeDurationNodes(child, symbol, currentSymbol));
}

function parseRanges(response: UnknownRecord, symbol: string): DerivDurationRange[] {
  const nodes = collectTradeDurationNodes(response.trading_durations, symbol);
  const ranges: DerivDurationRange[] = [];

  for (const node of nodes) {
    for (const rawDuration of node.durations) {
      const duration = asRecord(rawDuration);
      if (!duration) continue;

      const explicitUnit = normalizeUnit(duration.unit ?? duration.duration_unit ?? duration.units);
      const min = parseBoundary(duration, ['min', 'minimum', 'min_duration', 'min_contract_duration'], explicitUnit);
      const max = parseBoundary(duration, ['max', 'maximum', 'max_duration', 'max_contract_duration'], explicitUnit);
      if (!min || !max) continue;

      const unit = explicitUnit ?? min.unit;
      if (min.unit !== unit || max.unit !== unit) continue;
      if (!Number.isSafeInteger(min.value) || !Number.isSafeInteger(max.value) || min.value <= 0 || max.value < min.value) continue;

      ranges.push({
        id: `${symbol}:${node.tradeType || 'unknown'}:${unit}:${min.value}-${max.value}`,
        unit,
        min: min.value,
        max: max.value,
        tradeTypes: node.tradeType ? [node.tradeType] : [],
        source: 'deriv-trading-durations',
      });
    }
  }

  const merged = new Map<string, DerivDurationRange>();
  for (const range of ranges) {
    const key = `${range.unit}:${range.min}:${range.max}`;
    const existing = merged.get(key);
    if (existing) {
      existing.tradeTypes = Array.from(new Set([...existing.tradeTypes, ...range.tradeTypes])).sort();
    } else {
      merged.set(key, { ...range });
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    const unitOrder = ['t', 's', 'm', 'h', 'd'];
    const unitDelta = unitOrder.indexOf(a.unit) - unitOrder.indexOf(b.unit);
    return unitDelta || a.min - b.min || a.max - b.max;
  });
}

async function requestTradingDurations(symbol: string, timeoutMs = 10_000): Promise<DerivDurationDiscovery> {
  const ws = await openDerivPublicWebSocket(timeoutMs);

  return new Promise<DerivDurationDiscovery>((resolve, reject) => {
    let handled = false;
    const reqId = Date.now() % 2_000_000_000;
    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      try { ws.close(); } catch {}
      reject(new Error(`Deriv duration discovery timed out for ${symbol}.`));
    }, timeoutMs);

    const fail = (error: Error) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      reject(error);
    };

    ws.send(JSON.stringify({ trading_durations: 1, req_id }));

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString()) as UnknownRecord;
        if (response.error) {
          const error = asRecord(response.error);
          fail(new Error(`Deriv duration discovery failed${error?.code ? ` (${String(error.code)})` : ''}: ${String(error?.message || 'Unknown Deriv error')}`));
          return;
        }
        if (response.msg_type !== 'trading_durations') return;

        const ranges = parseRanges(response, symbol);
        if (!ranges.length) {
          fail(new Error(`Deriv returned no supported trading-duration ranges for ${symbol}.`));
          return;
        }

        handled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve({ symbol, ranges, fetchedAt: new Date().toISOString(), source: 'deriv-trading-durations' });
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Invalid Deriv duration response.'));
      }
    });

    ws.on('error', (error) => fail(error instanceof Error ? error : new Error('Deriv duration WebSocket error.')));
    ws.on('close', () => {
      if (!handled) fail(new Error(`Deriv duration discovery connection closed before data was received for ${symbol}.`));
    });
  });
}

export async function getDerivDurationDiscovery(symbol: string): Promise<DerivDurationDiscovery> {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) throw new Error('A Deriv symbol is required for duration discovery.');
  return requestTradingDurations(normalized);
}

export function durationToSeconds(value: number, unit: DerivDurationUnit): number | null {
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  if (unit === 't') return null;
  return value * UNIT_SECONDS[unit];
}

export function durationLabel(value: number, unit: DerivDurationUnit): string {
  const labels: Record<DerivDurationUnit, string> = { t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours', d: 'days' };
  return `${value} ${labels[unit]}`;
}

export function durationRangeLabel(range: DerivDurationRange): string {
  return range.min === range.max
    ? durationLabel(range.min, range.unit)
    : `${durationLabel(range.min, range.unit)} – ${durationLabel(range.max, range.unit)}`;
}

/**
 * Returns deterministic training points from a broker-provided duration range.
 * Exact boundaries are always included. For small integer ranges, every value
 * is included; large ranges remain represented by their boundaries until the
 * training-grid policy is explicitly configured.
 */
export function expandTrainingDurations(ranges: DerivDurationRange[], maxExpandedPerRange = 128): Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> {
  const result: Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> = [];
  for (const range of ranges) {
    const span = range.max - range.min;
    if (span <= maxExpandedPerRange) {
      for (let value = range.min; value <= range.max; value += 1) {
        result.push({ value, unit: range.unit, rangeId: range.id });
      }
    } else {
      result.push({ value: range.min, unit: range.unit, rangeId: range.id });
      if (range.max !== range.min) result.push({ value: range.max, unit: range.unit, rangeId: range.id });
    }
  }
  const seen = new Set<string>();
  return result.filter((item) => {
    const key = `${item.value}:${item.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
