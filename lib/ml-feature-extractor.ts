export interface TickPoint {
  price: number;
  timestamp?: number;
}

export interface FeatureWindowProfile {
  micro: number;
  short: number;
  medium: number;
  macro: number;
}

export interface FeatureExtractionOptions {
  contractDurationSecs?: number;
  symbol?: string;
  assetCategoryNum?: number;
  windowProfile?: FeatureWindowProfile;
}

export interface EngineeredTickFeatures {
  deltaP1: number;
  deltaP2: number;
  deltaP3: number;
  micro_momentum: number;
  short_momentum: number;
  medium_momentum: number;
  macro_momentum: number;
  short_range: number;
  medium_displacement: number;
  macro_displacement: number;
  up_tick_ratio: number;
  down_tick_ratio: number;
  directional_imbalance: number;
  consecutive_up: number;
  consecutive_down: number;
  micro_persistence: number;
  short_persistence: number;
  short_reversal_rate: number;
  medium_reversal_rate: number;
  micro_velocity: number;
  short_velocity: number;
  medium_velocity: number;
  acceleration: number;
  ticks_per_second: number;
  velocity_per_second: number;
  short_volatility: number;
  medium_volatility: number;
  macro_volatility: number;
  short_rangeCompression: number;
  medium_distHigh: number;
  medium_distLow: number;
  macro_regime: number;
  is1SecondSynthetic: number;
  contractDurationSecs: number;
  durationFactor: number;
  digitFrequency: number;
  assetCategory: number;
}

function normalizeWindow(value: number | undefined, fallback: number): number {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : fallback;
}

export function extract37TickFeatures(
  rawTicks: TickPoint[],
  options: FeatureExtractionOptions = {}
): EngineeredTickFeatures {
  if (!Array.isArray(rawTicks) || rawTicks.length === 0) {
    throw new Error('Real tick data is required to compute training features.');
  }

  const {
    contractDurationSecs = 5,
    symbol = '',
    assetCategoryNum = 0.0,
    windowProfile,
  } = options;

  const microWindow = normalizeWindow(windowProfile?.micro, 5);
  const shortWindow = normalizeWindow(windowProfile?.short, 25);
  const mediumWindow = normalizeWindow(windowProfile?.medium, 100);
  const macroWindow = normalizeWindow(windowProfile?.macro, 300);

  const ticks = rawTicks;
  const prices = ticks.map((t) => t.price);
  const totalCount = prices.length;
  const currentPrice = prices[totalCount - 1];

  const getSubArray = (count: number) => prices.slice(Math.max(0, totalCount - count));

  const pN = prices[totalCount - 1];
  const pN1 = prices[totalCount - 2] ?? pN;
  const pN2 = prices[totalCount - 3] ?? pN1;
  const pN3 = prices[totalCount - 4] ?? pN2;

  const deltaP1 = pN - pN1;
  const deltaP2 = pN - pN2;
  const deltaP3 = pN - pN3;

  const calcMomentum = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const start = arr[0];
    return start === 0 ? 0 : ((arr[arr.length - 1] - start) / start) * 100;
  };

  const calcVelocity = (arr: number[]) => {
    if (arr.length < 2) return 0;
    return (arr[arr.length - 1] - arr[0]) / arr.length;
  };

  const calcVolatility = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  };

  let upCount = 0;
  let downCount = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) upCount++;
    else if (prices[i] < prices[i - 1]) downCount++;
  }
  const totalDiffs = Math.max(1, prices.length - 1);
  const up_tick_ratio = upCount / totalDiffs;
  const down_tick_ratio = downCount / totalDiffs;
  const directional_imbalance = (upCount - downCount) / totalDiffs;

  let consecutive_up = 0;
  let consecutive_down = 0;
  for (let i = prices.length - 1; i >= 1; i--) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      if (consecutive_down > 0) break;
      consecutive_up++;
    } else if (diff < 0) {
      if (consecutive_up > 0) break;
      consecutive_down++;
    } else {
      break;
    }
  }

  const calcPersistence = (arr: number[]) => {
    if (arr.length < 2) return 0;
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < arr.length; i++) {
      const dirCurrent = Math.sign(arr[i] - arr[i - 1]);
      const dirPrev = Math.sign(arr[i - 1] - (arr[i - 2] ?? arr[i - 1]));
      if (dirCurrent !== 0 && dirCurrent === dirPrev) {
        currentRun++;
        if (currentRun > maxRun) maxRun = currentRun;
      } else {
        currentRun = 1;
      }
    }
    return maxRun / arr.length;
  };

  const calcReversalRate = (arr: number[]) => {
    if (arr.length < 3) return 0;
    let reversals = 0;
    for (let i = 2; i < arr.length; i++) {
      const diff1 = arr[i - 1] - arr[i - 2];
      const diff2 = arr[i] - arr[i - 1];
      if ((diff1 > 0 && diff2 < 0) || (diff1 < 0 && diff2 > 0)) reversals++;
    }
    return reversals / (arr.length - 2);
  };

  const microTicks = getSubArray(microWindow);
  const shortTicks = getSubArray(shortWindow);
  const medTicks = getSubArray(mediumWindow);
  const macroTicks = getSubArray(macroWindow);

  const micro_momentum = calcMomentum(microTicks);
  const micro_velocity = calcVelocity(microTicks);
  const micro_persistence = calcPersistence(microTicks);

  const short_momentum = calcMomentum(shortTicks);
  const short_velocity = calcVelocity(shortTicks);
  const v1 = calcVelocity(shortTicks.slice(0, Math.floor(shortTicks.length / 2)));
  const v2 = calcVelocity(shortTicks.slice(Math.floor(shortTicks.length / 2)));
  const acceleration = v2 - v1;
  const short_persistence = calcPersistence(shortTicks);
  const short_reversal_rate = calcReversalRate(shortTicks);
  const short_volatility = calcVolatility(shortTicks);
  const shortHigh = Math.max(...shortTicks);
  const shortLow = Math.min(...shortTicks);
  const short_range = shortHigh - shortLow;
  const short_rangeCompression = short_range === 0 ? 0.5 : (shortTicks[shortTicks.length - 1] - shortLow) / short_range;

  const medium_momentum = calcMomentum(medTicks);
  const medium_velocity = calcVelocity(medTicks);
  const medium_reversal_rate = calcReversalRate(medTicks);
  const medium_volatility = calcVolatility(medTicks);
  const medium_displacement = Math.abs(medTicks[medTicks.length - 1] - medTicks[0]);
  const medHigh = Math.max(...medTicks);
  const medLow = Math.min(...medTicks);
  const medium_distHigh = medHigh - currentPrice;
  const medium_distLow = currentPrice - medLow;

  const macro_momentum = calcMomentum(macroTicks);
  const macro_volatility = calcVolatility(macroTicks);
  const macro_displacement = Math.abs(macroTicks[macroTicks.length - 1] - macroTicks[0]);
  const macro_regime = macro_momentum > 0.05 ? 1.0 : macro_momentum < -0.05 ? -1.0 : 0.0;

  const is1Sec = symbol.startsWith('1HZ') || symbol.includes('1S') ? 1.0 : 0.0;
  const firstTickTs = ticks[0]?.timestamp;
  const lastTickTs = ticks[ticks.length - 1]?.timestamp;
  const elapsedTimeSec = firstTickTs != null && lastTickTs != null
    ? Math.max(0.001, (lastTickTs - firstTickTs) / 1000)
    : Math.max(0.001, ticks.length - 1);

  const velocity_per_second = (currentPrice - ticks[0].price) / elapsedTimeSec;
  const ticks_per_second = totalCount / elapsedTimeSec;
  const durationFactor = Math.log(Math.max(1, contractDurationSecs));

  let evenDigits = 0;
  ticks.forEach((t) => {
    const str = t.price.toFixed(5);
    const lastDigit = parseInt(str.slice(-1), 10);
    if (!isNaN(lastDigit) && lastDigit % 2 === 0) evenDigits++;
  });
  const digitFrequency = totalCount > 0 ? evenDigits / totalCount : 0.5;

  return {
    deltaP1,
    deltaP2,
    deltaP3,
    micro_momentum,
    short_momentum,
    medium_momentum,
    macro_momentum,
    short_range,
    medium_displacement,
    macro_displacement,
    up_tick_ratio,
    down_tick_ratio,
    directional_imbalance,
    consecutive_up,
    consecutive_down,
    micro_persistence,
    short_persistence,
    short_reversal_rate,
    medium_reversal_rate,
    micro_velocity,
    short_velocity,
    medium_velocity,
    acceleration,
    ticks_per_second,
    velocity_per_second,
    short_volatility,
    medium_volatility,
    macro_volatility,
    short_rangeCompression,
    medium_distHigh,
    medium_distLow,
    macro_regime,
    is1SecondSynthetic: is1Sec,
    contractDurationSecs,
    durationFactor,
    digitFrequency,
    assetCategory: assetCategoryNum,
  };
}

export function featureObjToArray(features: EngineeredTickFeatures): number[] {
  return [
    features.deltaP1,
    features.deltaP2,
    features.deltaP3,
    features.micro_momentum,
    features.short_momentum,
    features.medium_momentum,
    features.macro_momentum,
    features.short_range,
    features.medium_displacement,
    features.macro_displacement,
    features.up_tick_ratio,
    features.down_tick_ratio,
    features.directional_imbalance,
    features.consecutive_up,
    features.consecutive_down,
    features.micro_persistence,
    features.short_persistence,
    features.short_reversal_rate,
    features.medium_reversal_rate,
    features.micro_velocity,
    features.short_velocity,
    features.medium_velocity,
    features.acceleration,
    features.ticks_per_second,
    features.velocity_per_second,
    features.short_volatility,
    features.medium_volatility,
    features.macro_volatility,
    features.short_rangeCompression,
    features.medium_distHigh,
    features.medium_distLow,
    features.macro_regime,
    features.is1SecondSynthetic,
    features.contractDurationSecs,
    features.durationFactor,
    features.digitFrequency,
    features.assetCategory,
  ];
}
