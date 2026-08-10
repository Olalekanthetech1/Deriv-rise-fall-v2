import type { ContractInfo } from '@deriv/core';
import { DERIV_TIME_DURATION_BANDS } from './deriv-duration-policy';

export type DurationApiUnit = 't' | 's' | 'm' | 'd';
export type DurationSelectUnit = 't' | 's' | 'm' | 'h' | 'd' | 'end-time';

export interface DurationOption {
  unit: DurationSelectUnit;
  label: string;
  min: number;
  max: number;
}

export interface TradingEvent {
  dates: string;
  descrip: string;
}

export interface TradingSymbolData {
  underlying_symbol: string;
  name: string;
  times: {
    open: string[];
    close: string[];
  };
  trading_days: string[];
  events: TradingEvent[];
}

const DURATION_ORDER: DurationSelectUnit[] = ['t', 's', 'm', 'h', 'd', 'end-time'];

const DURATION_LABELS: Record<DurationSelectUnit, string> = {
  t: 'Ticks',
  s: 'Seconds',
  m: 'Minutes',
  h: 'Hours',
  d: 'Days',
  'end-time': 'End Time',
};

function parseDurationToSeconds(durationStr: string): number {
  const num = parseInt(durationStr, 10);
  const unit = durationStr.replace(/^\d+/, '');
  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    case 'd': return num * 86400;
    default: return num;
  }
}

export function getDurationOptions(contracts: ContractInfo[]): DurationOption[] {
  const optMap = new Map<DurationSelectUnit, DurationOption>();

  for (const contract of contracts) {
    const minStr = contract.min_contract_duration;
    const maxStr = contract.max_contract_duration;
    const expiryType = contract.expiry_type;

    if (expiryType === 'tick') {
      if (!optMap.has('t')) {
        optMap.set('t', { unit: 't', label: DURATION_LABELS.t, min: parseInt(minStr, 10), max: parseInt(maxStr, 10) });
      }
    } else if (expiryType === 'intraday') {
      const minSec = parseDurationToSeconds(minStr);
      const maxSec = parseDurationToSeconds(maxStr);

      if (maxSec >= DERIV_TIME_DURATION_BANDS.s.min && !optMap.has('s')) {
        const sMin = Math.max(DERIV_TIME_DURATION_BANDS.s.min, minSec);
        const sMax = Math.min(DERIV_TIME_DURATION_BANDS.s.max, maxSec);
        if (sMin <= sMax) optMap.set('s', { unit: 's', label: DURATION_LABELS.s, min: sMin, max: sMax });
      }

      if (maxSec >= 60 && !optMap.has('m')) {
        const mMin = Math.max(DERIV_TIME_DURATION_BANDS.m.min, Math.ceil(minSec / 60));
        const mMax = Math.min(DERIV_TIME_DURATION_BANDS.m.max, Math.floor(maxSec / 60));
        if (mMin <= mMax) optMap.set('m', { unit: 'm', label: DURATION_LABELS.m, min: mMin, max: mMax });
      }

      if (maxSec >= 3600 && !optMap.has('h')) {
        const hMin = Math.max(DERIV_TIME_DURATION_BANDS.h.min, Math.ceil(minSec / 3600));
        const hMax = Math.min(DERIV_TIME_DURATION_BANDS.h.max, Math.floor(maxSec / 3600));
        if (hMin <= hMax) optMap.set('h', { unit: 'h', label: DURATION_LABELS.h, min: hMin, max: hMax });
      }
    } else if (expiryType === 'daily') {
      const dMin = Math.max(DERIV_TIME_DURATION_BANDS.d.min, parseInt(minStr, 10));
      const dMax = Math.min(DERIV_TIME_DURATION_BANDS.d.max, parseInt(maxStr, 10));
      if (!optMap.has('d') && dMin <= dMax) optMap.set('d', { unit: 'd', label: DURATION_LABELS.d, min: dMin, max: dMax });
      if (!optMap.has('end-time') && dMin <= dMax) optMap.set('end-time', { unit: 'end-time', label: DURATION_LABELS['end-time'], min: dMin, max: dMax });
    }
  }

  return DURATION_ORDER.reduce<DurationOption[]>((acc, u) => {
    const opt = optMap.get(u);
    if (opt) acc.push(opt);
    return acc;
  }, []);
}

export function computeEndTimeEpoch(date: Date | undefined, timeStr: string): number | null {
  if (!date || !timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10);
  const mins = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(mins)) return null;
  // timeStr is GMT — use local date components (calendar dates are at local midnight)
  // combined with UTC hours/mins to get the correct UTC epoch
  const secs = parts.length >= 3 ? (parseInt(parts[2], 10) || 0) : 0;
  const epochMs = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, mins, secs, 0);
  const epochSec = Math.floor(epochMs / 1000);
  if (epochSec <= Math.floor(Date.now() / 1000)) return null;
  return epochSec;
}

export function parseTradingDays(tradingDays: string[]): number[] {
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const tradingSet = new Set<number>();
  for (const d of tradingDays) {
    const idx = dayMap[d];
    if (idx !== undefined) tradingSet.add(idx);
  }
  return [0, 1, 2, 3, 4, 5, 6].filter(d => !tradingSet.has(d));
}

export function getEarlyCloseDates(events: TradingEvent[], month: Date): Date[] {
  const year = month.getFullYear();
  const monthNum = month.getMonth();
  const result: Date[] = [];
  for (const event of events) {
    if (!event.descrip.toLowerCase().includes('closes early')) continue;
    for (const dateStr of event.dates.split(',').map(d => d.trim())) {
      // Parse as local midnight to match how Calendar creates date objects
      const parts = dateStr.split('-');
      if (parts.length !== 3) continue;
      const y = parseInt(parts[0], 10);
      const mo = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (isNaN(y) || isNaN(mo) || isNaN(day)) continue;
      if (y === year && mo === monthNum) {
        result.push(new Date(y, mo, day));
      }
    }
  }
  return result;
}

export function parseCloseTime(closeArr: string[]): string {
  if (!closeArr || closeArr.length === 0) return '';
  const parts = closeArr[closeArr.length - 1].split(':');
  if (parts.length < 2) return '';
  const hh = parts[0].padStart(2, '0');
  const mm = parts[1].padStart(2, '0');
  const ss = (parts[2] ?? '00').padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function getCloseTimeForDate(data: TradingSymbolData, date: Date): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNamePlural = `${dayNames[date.getDay()]}s`;
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${mo}-${d}`;

  for (const event of data.events) {
    if (!event.descrip.toLowerCase().includes('closes early')) continue;
    const applies = event.dates.split(',').map(s => s.trim()).some(s => s === dayNamePlural || s === dateStr);
    if (!applies) continue;
    const match = event.descrip.match(/\(at (\d{1,2}):(\d{2})\)/);
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}:00`;
  }

  return parseCloseTime(data.times.close);
}

export type AutoHorizonMode = 'auto' | 't' | 's' | 'm' | 'h' | 'd';

export function calculateDynamicOptimalDuration(
  durationOptions: DurationOption[],
  activeSymbol?: { market?: string; market_display_name?: string; underlying_symbol?: string } | null,
  autoHorizonMode: AutoHorizonMode = 'auto',
  prices?: number[]
): {
  duration: number;
  unit: DurationSelectUnit;
  label: string;
  explanation: string;
  availableUnits: DurationSelectUnit[];
} {
  if (!durationOptions || durationOptions.length === 0) {
    return {
      duration: 5,
      unit: 't',
      label: '5 Ticks',
      explanation: 'Default contract duration',
      availableUnits: ['t'],
    };
  }

  const availableUnits = durationOptions.map((o) => o.unit);
  const optMap = new Map<DurationSelectUnit, DurationOption>();
  for (const opt of durationOptions) {
    optMap.set(opt.unit, opt);
  }

  // --- QUANTITATIVE MARKET ANALYSIS FROM PRICE SERIES ---
  let er = 0.5; // Kaufman Efficiency Ratio (0 = Noise/Chop, 1 = Clean Trend)
  let volatilityPct = 0.2; // Relative Volatility percentage

  if (prices && prices.length >= 3) {
    const N = Math.min(prices.length, 30);
    const recentPrices = prices.slice(prices.length - N);
    
    let totalPath = 0;
    for (let i = 1; i < recentPrices.length; i++) {
      totalPath += Math.abs(recentPrices[i] - recentPrices[i - 1]);
    }
    const netShift = Math.abs(recentPrices[recentPrices.length - 1] - recentPrices[0]);
    er = totalPath > 0 ? netShift / totalPath : 0.5;

    const meanP = recentPrices.reduce((a, b) => a + b, 0) / N;
    if (meanP > 0) {
      const variance = recentPrices.reduce((acc, p) => acc + Math.pow(p - meanP, 2), 0) / N;
      const stdDev = Math.sqrt(variance);
      volatilityPct = (stdDev / meanP) * 100;
    }
  }

  // Helper to systematically compute dynamic target for any given unit
  const computeForUnit = (unit: DurationSelectUnit) => {
    const opt = optMap.get(unit);
    if (!opt) return null;

    if (unit === 't') {
      // High efficiency (>0.6) = fast precision scalp (3-5 ticks). Low efficiency (<0.3) = wider noise buffer (7-10 ticks).
      const rawVal = opt.min + (1 - er) * (Math.min(opt.max, 10) - opt.min);
      const computed = Math.min(opt.max, Math.max(opt.min, Math.round(rawVal)));
      const erDesc = er > 0.6 ? 'High trend momentum' : er < 0.35 ? 'Noise buffer expansion' : 'Optimal momentum balance';
      return {
        duration: computed,
        unit: 't' as DurationSelectUnit,
        label: `${computed} Tick${computed > 1 ? 's' : ''}`,
        explanation: `Quantitative Tick Analysis (ER: ${er.toFixed(2)}): ${erDesc} → ${computed} Ticks (${opt.min}-${opt.max})`,
        availableUnits,
      };
    }

    if (unit === 's') {
      // Dynamic seconds derived from volatility & efficiency
      const rawVal = opt.min + (1 - er) * 15 + Math.min(30, volatilityPct * 10);
      const computed = Math.min(opt.max, Math.max(opt.min, Math.round(rawVal)));
      return {
        duration: computed,
        unit: 's' as DurationSelectUnit,
        label: `${computed} Seconds`,
        explanation: `Quantitative Second Horizon (ER: ${er.toFixed(2)} | Vol: ${volatilityPct.toFixed(2)}%): ${computed} Seconds optimal window`,
        availableUnits,
      };
    }

    if (unit === 'm') {
      // Dynamic minutes derived from directional persistence
      const rawVal = opt.min + Math.round((1 - er) * 2);
      const computed = Math.min(opt.max, Math.max(opt.min, rawVal));
      return {
        duration: computed,
        unit: 'm' as DurationSelectUnit,
        label: `${computed} Minute${computed > 1 ? 's' : ''}`,
        explanation: `Quantitative Intraday Analysis (ER: ${er.toFixed(2)}): Dynamic trend window ${computed} Minute${computed > 1 ? 's' : ''}`,
        availableUnits,
      };
    }

    if (unit === 'h') {
      const computed = Math.min(opt.max, Math.max(opt.min, 1));
      return {
        duration: computed,
        unit: 'h' as DurationSelectUnit,
        label: `${computed} Hour${computed > 1 ? 's' : ''}`,
        explanation: `Macro Hourly Contract (${opt.min}h-${opt.max}h): Dynamic baseline set to ${computed} Hour`,
        availableUnits,
      };
    }

    const computed = opt.min;
    return {
      duration: computed,
      unit: opt.unit,
      label: `${computed} ${opt.label}`,
      explanation: `Contract boundary limit (${opt.min}-${opt.max})`,
      availableUnits,
    };
  };

  // --- USER EXPLICIT HORIZON PREFERENCE ---
  if (autoHorizonMode !== 'auto' && optMap.has(autoHorizonMode as DurationSelectUnit)) {
    const customResult = computeForUnit(autoHorizonMode as DurationSelectUnit);
    if (customResult) return customResult;
  }

  // --- DYNAMIC SYSTEMATIC UNIT SELECTION ('auto' mode) ---
  // Systematically select the optimal duration unit (s, m, t, h) based on live market dynamics:
  // 1. High Volatility / Noise (ER < 0.30): Ticks are prone to slippage & false noise; recommend Seconds ('s') or Minutes ('m') for smooth execution window.
  // 2. High Trend Efficiency (ER > 0.55): Micro-trend is clean & strong; recommend Ticks ('t') for immediate execution precision.
  // 3. Moderate Volatility & Medium ER (0.30 <= ER <= 0.55): Recommend Seconds ('s') or Minutes ('m') depending on available options.

  if (er < 0.32) {
    // Chop / High noise -> prefer time-based units ('s', 'm') over ticks if available
    if (optMap.has('s')) return computeForUnit('s')!;
    if (optMap.has('m')) return computeForUnit('m')!;
    if (optMap.has('t')) return computeForUnit('t')!;
  } else if (er > 0.55) {
    // Clean trend -> high precision ticks ('t') or seconds ('s')
    if (optMap.has('t')) return computeForUnit('t')!;
    if (optMap.has('s')) return computeForUnit('s')!;
    if (optMap.has('m')) return computeForUnit('m')!;
  } else {
    // Moderate efficiency -> dynamic seconds ('s') or minutes ('m') or ticks ('t')
    if (volatilityPct > 0.15 && optMap.has('s')) return computeForUnit('s')!;
    if (optMap.has('m')) return computeForUnit('m')!;
    if (optMap.has('t')) return computeForUnit('t')!;
  }

  if (optMap.has('s')) return computeForUnit('s')!;
  if (optMap.has('t')) return computeForUnit('t')!;
  if (optMap.has('m')) return computeForUnit('m')!;
  if (optMap.has('h')) return computeForUnit('h')!;

  const firstOpt = durationOptions[0];
  return computeForUnit(firstOpt.unit)!;
}
