import WebSocket from 'ws';
import { openDerivPublicWebSocket } from './deriv-public-websocket';

export type DerivDurationUnit = 't' | 's' | 'm' | 'h' | 'd';
export type DerivDurationRange = {
  id: string;
  unit: DerivDurationUnit;
  min: number;
  max: number;
  tradeTypes: string[];
  source: 'deriv-contracts-for';
};
export type DerivDurationDiscovery = {
  symbol: string;
  ranges: DerivDurationRange[];
  fetchedAt: string;
  source: 'deriv-contracts-for';
};
type UnknownRecord = Record<string, unknown>;

const UNIT_ALIASES: Record<string, DerivDurationUnit> = {
  t: 't', tick: 't', ticks: 't',
  s: 's', second: 's', seconds: 's',
  m: 'm', minute: 'm', minutes: 'm',
  h: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function normalizeUnit(value: unknown): DerivDurationUnit | null {
  return UNIT_ALIASES[String(value ?? '').trim().toLowerCase()] ?? null;
}

function parseDurationToken(
  value: unknown,
  fallbackUnit: DerivDurationUnit | null = null,
): { value: number; unit: DerivDurationUnit } | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && fallbackUnit
      ? { value, unit: fallbackUnit }
      : null;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;

  if (fallbackUnit && /^\d+$/.test(text)) {
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? { value: parsed, unit: fallbackUnit }
      : null;
  }

  const match = text.match(/^(\d+)\s*([a-z]+)$/);
  if (!match) return null;

  const parsed = Number(match[1]);
  const unit = normalizeUnit(match[2]);
  return unit && Number.isSafeInteger(parsed) && parsed > 0
    ? { value: parsed, unit }
    : null;
}

function firstDurationToken(
  record: UnknownRecord,
  names: string[],
  fallbackUnit: DerivDurationUnit | null,
): { value: number; unit: DerivDurationUnit } | null {
  for (const name of names) {
    const parsed = parseDurationToken(record[name], fallbackUnit);
    if (parsed) return parsed;
  }
  return null;
}

function isRiseFallTradeType(value: string): boolean {
  const type = value.trim().toUpperCase();
  return type === 'CALL' || type === 'PUT' || type === 'CALLE' || type === 'PUTE' || type === 'RISE' || type === 'FALL';
}

function mergeRanges(ranges: DerivDurationRange[]): DerivDurationRange[] {
  const merged = new Map<string, DerivDurationRange>();

  for (const range of ranges) {
    const key = `${range.unit}:${range.min}:${range.max}`;
    const existing = merged.get(key);
    if (existing) {
      existing.tradeTypes = Array.from(new Set([...existing.tradeTypes, ...range.tradeTypes])).sort();
    } else {
      merged.set(key, { ...range, tradeTypes: [...range.tradeTypes].sort() });
    }
  }

  const unitOrder: DerivDurationUnit[] = ['t', 's', 'm', 'h', 'd'];
  return Array.from(merged.values()).sort(
    (a, b) => unitOrder.indexOf(a.unit) - unitOrder.indexOf(b.unit) || a.min - b.min || a.max - b.max,
  );
}

function parseContractDuration(contract: UnknownRecord, symbol: string): DerivDurationRange | null {
  const tradeType = String(
    contract.contract_type ??
    contract.trade_type ??
    contract.contract_category ??
    contract.type ??
    '',
  ).trim();

  if (!tradeType || !isRiseFallTradeType(tradeType)) return null;

  // Deriv contracts_for responses use duration_units together with
  // min/max_contract_duration (and, depending on API version, duration_min/max).
  const explicitUnit = normalizeUnit(
    contract.duration_units ??
    contract.duration_unit ??
    contract.unit ??
    contract.units,
  );

  const min = firstDurationToken(
    contract,
    [
      'min_contract_duration',
      'minimum_contract_duration',
      'duration_min',
      'min_duration',
      'minimum_duration',
      'min',
    ],
    explicitUnit,
  );
  const max = firstDurationToken(
    contract,
    [
      'max_contract_duration',
      'maximum_contract_duration',
      'duration_max',
      'max_duration',
      'maximum_duration',
      'max',
    ],
    explicitUnit,
  );

  if (!min || !max || min.unit !== max.unit || max.value < min.value) return null;

  return {
    id: `${symbol}:${tradeType}:${min.unit}:${min.value}-${max.value}`,
    unit: min.unit,
    min: min.value,
    max: max.value,
    tradeTypes: [tradeType],
    source: 'deriv-contracts-for',
  };
}

function parseContractsFor(response: UnknownRecord, symbol: string): DerivDurationRange[] {
  const contractsFor = asRecord(response.contracts_for);
  const available = contractsFor?.available;
  if (!Array.isArray(available)) return [];

  return mergeRanges(
    available
      .map((item) => asRecord(item))
      .filter((item): item is UnknownRecord => Boolean(item))
      .map((contract) => parseContractDuration(contract, symbol))
      .filter((range): range is DerivDurationRange => Boolean(range)),
  );
}

async function requestDeriv(
  symbol: string,
  request: UnknownRecord,
  expectedMsgType: string,
  timeoutMs: number,
): Promise<UnknownRecord> {
  const ws = await openDerivPublicWebSocket(timeoutMs);

  return new Promise((resolve, reject) => {
    let handled = false;
    const reqId = Date.now() % 2_000_000_000;

    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      try { ws.close(); } catch {}
      reject(new Error(`Deriv ${expectedMsgType} discovery timed out for ${symbol}.`));
    }, timeoutMs);

    const fail = (error: Error) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      reject(error);
    };

    try {
      ws.send(JSON.stringify({ ...request, req_id: reqId }));
    } catch (error) {
      fail(error instanceof Error ? error : new Error(`Unable to request Deriv ${expectedMsgType}.`));
      return;
    }

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString()) as UnknownRecord;
        if (response.error) {
          const error = asRecord(response.error);
          fail(new Error(
            `Deriv ${expectedMsgType} discovery failed${error?.code ? ` (${String(error.code)})` : ''}: ${String(error?.message || 'Unknown Deriv error')}`,
          ));
          return;
        }
        if (response.msg_type !== expectedMsgType) return;

        handled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve(response);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(`Invalid Deriv ${expectedMsgType} response.`));
      }
    });

    ws.on('error', (error) => fail(
      error instanceof Error ? error : new Error(`Deriv ${expectedMsgType} WebSocket error.`),
    ));

    ws.on('close', () => {
      if (!handled) {
        fail(new Error(`Deriv ${expectedMsgType} connection closed before data was received for ${symbol}.`));
      }
    });
  });
}

export async function getDerivDurationDiscovery(symbol: string): Promise<DerivDurationDiscovery> {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) throw new Error('A Deriv symbol is required for duration discovery.');

  // contracts_for is the authoritative asset-specific capability request for
  // contract types and their duration boundaries. Do not call unsupported
  // trading_durations or asset_index operations as primary discovery APIs.
  const response = await requestDeriv(
    normalized,
    { contracts_for: normalized },
    'contracts_for',
    10_000,
  );

  const ranges = parseContractsFor(response, normalized).filter((range) =>
    range.tradeTypes.some(isRiseFallTradeType),
  );

  if (!ranges.length) {
    throw new Error(`Deriv returned no supported Rise/Fall duration ranges for ${normalized}.`);
  }

  return {
    symbol: normalized,
    ranges,
    fetchedAt: new Date().toISOString(),
    source: 'deriv-contracts-for',
  };
}

export function durationToSeconds(value: number, unit: DerivDurationUnit): number | null {
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const secondsPerUnit: Record<Exclude<DerivDurationUnit, 't'>, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return unit === 't' ? null : value * secondsPerUnit[unit];
}

export function durationLabel(value: number, unit: DerivDurationUnit): string {
  const labels: Record<DerivDurationUnit, string> = {
    t: 'ticks',
    s: 'seconds',
    m: 'minutes',
    h: 'hours',
    d: 'days',
  };
  return `${value} ${labels[unit]}`;
}

export function durationRangeLabel(range: DerivDurationRange): string {
  return range.min === range.max
    ? durationLabel(range.min, range.unit)
    : `${durationLabel(range.min, range.unit)} – ${durationLabel(range.max, range.unit)}`;
}

export function expandTrainingDurations(
  ranges: DerivDurationRange[],
  maxExpandedPerRange = 128,
): Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> {
  const result: Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> = [];

  for (const range of ranges) {
    const span = range.max - range.min;
    if (span <= maxExpandedPerRange) {
      for (let value = range.min; value <= range.max; value += 1) {
        result.push({ value, unit: range.unit, rangeId: range.id });
      }
    } else {
      result.push({ value: range.min, unit: range.unit, rangeId: range.id });
      if (range.max !== range.min) {
        result.push({ value: range.max, unit: range.unit, rangeId: range.id });
      }
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
