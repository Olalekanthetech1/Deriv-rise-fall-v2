export interface TickPoint {
  price: number;
  timestamp?: number;
}

export interface FeatureExtractionOptions {
  contractDurationSecs?: number;
  symbol?: string;
  assetCategoryNum?: number; // 0.0 for Synthetics, 1.0 for Forex, 2.0 for Metals
}

export interface EngineeredTickFeatures {
  // Micro Horizon (5 Ticks)
  micro_momentum: number;
  micro_velocity: number;
  micro_upDownRatio: number;
  micro_persistence: number;

  // Short Horizon (25 Ticks)
  short_momentum: number;
  short_velocity: number;
  short_acceleration: number;
  short_upDownRatio: number;
  short_persistence: number;
  short_reversalFreq: number;
  short_volatility: number;
  short_rangeCompression: number;

  // Medium Horizon (100 Ticks)
  medium_momentum: number;
  medium_velocity: number;
  medium_upDownRatio: number;
  medium_persistence: number;
  medium_reversalFreq: number;
  medium_volatility: number;
  medium_displacement: number;
  medium_distHigh: number;
  medium_distLow: number;

  // Macro Horizon (300 Ticks)
  macro_momentum: number;
  macro_upDownRatio: number;
  macro_persistence: number;
  macro_volatility: number;
  macro_displacement: number;
  macro_regime: number; // 1.0 = Bullish, -1.0 = Bearish, 0.0 = Neutral

  // Metadata & Digit Analysis
  is1SecondSynthetic: number; // 1.0 or 0.0
  velocityPerSecond: number;
  ticksPerSecond: number;
  elapsedTime300Sec: number;
  contractDurationSecs: number;
  durationFactor: number;
  digitFrequency: number; // Last digit even/odd ratio
  assetCategory: number;
}

export function extract37TickFeatures(
  rawTicks: TickPoint[],
  options: FeatureExtractionOptions = {}
): EngineeredTickFeatures {
  const {
    contractDurationSecs = 5,
    symbol = '',
    assetCategoryNum = 0.0,
  } = options;

  // Ensure minimum tick padding dynamically
  const ticks = rawTicks.length > 0 ? rawTicks : [{ price: 100, timestamp: Date.now() }];
  const prices = ticks.map((t) => t.price);
  const totalCount = prices.length;
  const currentPrice = prices[totalCount - 1];

  // Helper calculation functions
  const getSubArray = (count: number) => prices.slice(Math.max(0, totalCount - count));

  const calcMomentum = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const start = arr[0];
    return start === 0 ? 0 : ((arr[arr.length - 1] - start) / start) * 100;
  };

  const calcVelocity = (arr: number[]) => {
    if (arr.length < 2) return 0;
    return (arr[arr.length - 1] - arr[0]) / arr.length;
  };

  const calcUpDownRatio = (arr: number[]) => {
    if (arr.length < 2) return 0.5;
    let up = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > arr[i - 1]) up++;
    }
    return up / (arr.length - 1);
  };

  const calcPersistence = (arr: number[]) => {
    if (arr.length < 2) return 0;
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < arr.length; i++) {
      const dirCurrent = Math.sign(arr[i] - arr[i - 1]);
      const dirPrev = Math.sign(arr[i - 1] - arr[i - 2] || 0);
      if (dirCurrent !== 0 && dirCurrent === dirPrev) {
        currentRun++;
        if (currentRun > maxRun) maxRun = currentRun;
      } else {
        currentRun = 1;
      }
    }
    return maxRun / arr.length;
  };

  const calcReversalFreq = (arr: number[]) => {
    if (arr.length < 3) return 0;
    let reversals = 0;
    for (let i = 2; i < arr.length; i++) {
      const diff1 = arr[i - 1] - arr[i - 2];
      const diff2 = arr[i] - arr[i - 1];
      if ((diff1 > 0 && diff2 < 0) || (diff1 < 0 && diff2 > 0)) {
        reversals++;
      }
    }
    return reversals / (arr.length - 2);
  };

  const calcVolatility = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  };

  // 1. Micro Horizon (5 Ticks)
  const microTicks = getSubArray(5);
  const micro_momentum = calcMomentum(microTicks);
  const micro_velocity = calcVelocity(microTicks);
  const micro_upDownRatio = calcUpDownRatio(microTicks);
  const micro_persistence = calcPersistence(microTicks);

  // 2. Short Horizon (25 Ticks)
  const shortTicks = getSubArray(25);
  const short_momentum = calcMomentum(shortTicks);
  const short_velocity = calcVelocity(shortTicks);
  const v1 = calcVelocity(shortTicks.slice(0, Math.floor(shortTicks.length / 2)));
  const v2 = calcVelocity(shortTicks.slice(Math.floor(shortTicks.length / 2)));
  const short_acceleration = v2 - v1;
  const short_upDownRatio = calcUpDownRatio(shortTicks);
  const short_persistence = calcPersistence(shortTicks);
  const short_reversalFreq = calcReversalFreq(shortTicks);
  const short_volatility = calcVolatility(shortTicks);
  const shortHigh = Math.max(...shortTicks);
  const shortLow = Math.min(...shortTicks);
  const short_rangeCompression = shortHigh - shortLow === 0 ? 0 : (shortTicks[shortTicks.length - 1] - shortLow) / (shortHigh - shortLow);

  // 3. Medium Horizon (100 Ticks)
  const medTicks = getSubArray(100);
  const medium_momentum = calcMomentum(medTicks);
  const medium_velocity = calcVelocity(medTicks);
  const medium_upDownRatio = calcUpDownRatio(medTicks);
  const medium_persistence = calcPersistence(medTicks);
  const medium_reversalFreq = calcReversalFreq(medTicks);
  const medium_volatility = calcVolatility(medTicks);
  const medium_displacement = Math.abs(medTicks[medTicks.length - 1] - medTicks[0]);
  const medHigh = Math.max(...medTicks);
  const medLow = Math.min(...medTicks);
  const medium_distHigh = medHigh - currentPrice;
  const medium_distLow = currentPrice - medLow;

  // 4. Macro Horizon (300 Ticks)
  const macroTicks = getSubArray(300);
  const macro_momentum = calcMomentum(macroTicks);
  const macro_upDownRatio = calcUpDownRatio(macroTicks);
  const macro_persistence = calcPersistence(macroTicks);
  const macro_volatility = calcVolatility(macroTicks);
  const macro_displacement = Math.abs(macroTicks[macroTicks.length - 1] - macroTicks[0]);
  const macro_regime = macro_momentum > 0.05 ? 1.0 : macro_momentum < -0.05 ? -1.0 : 0.0;

  // 5. Contextual & Temporal Metadata
  const is1Sec = symbol.startsWith('1HZ') || symbol.includes('1S') ? 1.0 : 0.0;
  
  // Calculate real timestamps
  const firstTickTs = ticks[0]?.timestamp || Date.now() - ticks.length * 1000;
  const lastTickTs = ticks[ticks.length - 1]?.timestamp || Date.now();
  const elapsedTimeSec = Math.max(1, (lastTickTs - firstTickTs) / 1000);

  const velocityPerSecond = (currentPrice - ticks[0].price) / elapsedTimeSec;
  const ticksPerSecond = totalCount / elapsedTimeSec;
  const durationFactor = Math.log(Math.max(1, contractDurationSecs));

  // Digit Frequency analysis (Even vs Odd last decimal digit)
  let evenDigits = 0;
  ticks.forEach((t) => {
    const str = t.price.toFixed(5);
    const lastDigit = parseInt(str.slice(-1), 10);
    if (!isNaN(lastDigit) && lastDigit % 2 === 0) evenDigits++;
  });
  const digitFrequency = totalCount > 0 ? evenDigits / totalCount : 0.5;

  return {
    micro_momentum,
    micro_velocity,
    micro_upDownRatio,
    micro_persistence,

    short_momentum,
    short_velocity,
    short_acceleration,
    short_upDownRatio,
    short_persistence,
    short_reversalFreq,
    short_volatility,
    short_rangeCompression,

    medium_momentum,
    medium_velocity,
    medium_upDownRatio,
    medium_persistence,
    medium_reversalFreq,
    medium_volatility,
    medium_displacement,
    medium_distHigh,
    medium_distLow,

    macro_momentum,
    macro_upDownRatio,
    macro_persistence,
    macro_volatility,
    macro_displacement,
    macro_regime,

    is1SecondSynthetic: is1Sec,
    velocityPerSecond,
    ticksPerSecond,
    elapsedTime300Sec: elapsedTimeSec,
    contractDurationSecs,
    durationFactor,
    digitFrequency,
    assetCategory: assetCategoryNum,
  };
}

/**
 * Converts feature record object into ordered 37-dimensional numerical array
 */
export function featureObjToArray(features: EngineeredTickFeatures): number[] {
  return [
    features.micro_momentum,
    features.micro_velocity,
    features.micro_upDownRatio,
    features.micro_persistence,
    features.short_momentum,
    features.short_velocity,
    features.short_acceleration,
    features.short_upDownRatio,
    features.short_persistence,
    features.short_reversalFreq,
    features.short_volatility,
    features.short_rangeCompression,
    features.medium_momentum,
    features.medium_velocity,
    features.medium_upDownRatio,
    features.medium_persistence,
    features.medium_reversalFreq,
    features.medium_volatility,
    features.medium_displacement,
    features.medium_distHigh,
    features.medium_distLow,
    features.macro_momentum,
    features.macro_upDownRatio,
    features.macro_persistence,
    features.macro_volatility,
    features.macro_displacement,
    features.macro_regime,
    features.is1SecondSynthetic,
    features.velocityPerSecond,
    features.ticksPerSecond,
    features.elapsedTime300Sec,
    features.contractDurationSecs,
    features.durationFactor,
    features.digitFrequency,
    features.assetCategory,
  ];
}
