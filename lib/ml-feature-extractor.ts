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
  // --- Pillar 1: Price Behaviour (1-10) ---
  deltaP1: number;              // ΔP (1-tick price change)
  deltaP2: number;              // ΔP₂ (2-tick price change)
  deltaP3: number;              // ΔP₃ (3-tick price change)
  micro_momentum: number;       // 5-tick rate of change (%)
  short_momentum: number;       // 25-tick rate of change (%)
  medium_momentum: number;      // 100-tick rate of change (%)
  macro_momentum: number;       // 300-tick rate of change (%)
  short_range: number;          // 25-tick High - Low range
  medium_displacement: number;  // Net displacement over 100 ticks
  macro_displacement: number;   // Net displacement over 300 ticks

  // --- Pillar 2: Tick Pressure & Sequencing (11-19) ---
  up_tick_ratio: number;        // Overall percentage of upward ticks
  down_tick_ratio: number;      // Overall percentage of downward ticks
  directional_imbalance: number; // (up - down) / total imbalance [-1 to +1]
  consecutive_up: number;       // Active streak of consecutive UP ticks
  consecutive_down: number;     // Active streak of consecutive DOWN ticks
  micro_persistence: number;    // Max consecutive streak ratio (5 ticks)
  short_persistence: number;    // Max consecutive streak ratio (25 ticks)
  short_reversal_rate: number;  // Direction flip frequency over 25 ticks
  medium_reversal_rate: number; // Direction flip frequency over 100 ticks

  // --- Pillar 3: Tick Velocity & Acceleration (20-25) ---
  micro_velocity: number;       // Price change per tick over 5 ticks
  short_velocity: number;       // Price change per tick over 25 ticks
  medium_velocity: number;      // Price change per tick over 100 ticks
  acceleration: number;         // d²P/dt² (rate of speed change between window halves)
  ticks_per_second: number;     // Tick arrival frequency per second
  velocity_per_second: number;  // Price change per second (dP/dt)

  // --- Pillar 4: Short / Medium / Macro Volatility (26-31) ---
  short_volatility: number;     // 25-tick windowed standard deviation
  medium_volatility: number;    // 100-tick windowed standard deviation
  macro_volatility: number;     // 300-tick windowed standard deviation
  short_rangeCompression: number; // Relative position in 25-tick range [0..1]
  medium_distHigh: number;      // Distance to 100-tick peak
  medium_distLow: number;       // Distance to 100-tick floor

  // --- Contextual & Regime Metadata (32-37) ---
  macro_regime: number;         // Market regime classification (+1 Bull, -1 Bear, 0 Range)
  is1SecondSynthetic: number;   // Flag for 1-second synthetic indices (1.0 or 0.0)
  contractDurationSecs: number; // Contract duration in seconds
  durationFactor: number;       // Log-scaled duration factor
  digitFrequency: number;       // Last digit even/odd bias ratio
  assetCategory: number;        // Asset category encoder (0=Synthetic, 1=Forex, 2=Metals)
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

  // --- Pillar 1 Calculations: Price Behaviour ---
  const pN = prices[totalCount - 1] || 0;
  const pN1 = prices[totalCount - 2] ?? pN;
  const pN2 = prices[totalCount - 3] ?? pN1;
  const pN3 = prices[totalCount - 4] ?? pN2;

  const deltaP1 = pN - pN1; // ΔP
  const deltaP2 = pN - pN2; // ΔP₂
  const deltaP3 = pN - pN3; // ΔP₃

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

  // --- Pillar 2 Calculations: Tick Pressure & Sequencing ---
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

  // Active consecutive streaks
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
      if ((diff1 > 0 && diff2 < 0) || (diff1 < 0 && diff2 > 0)) {
        reversals++;
      }
    }
    return reversals / (arr.length - 2);
  };

  // --- Sub-arrays across horizons ---
  const microTicks = getSubArray(5);
  const shortTicks = getSubArray(25);
  const medTicks = getSubArray(100);
  const macroTicks = getSubArray(300);

  // Micro (5 Ticks)
  const micro_momentum = calcMomentum(microTicks);
  const micro_velocity = calcVelocity(microTicks);
  const micro_persistence = calcPersistence(microTicks);

  // Short (25 Ticks)
  const short_momentum = calcMomentum(shortTicks);
  const short_velocity = calcVelocity(shortTicks);
  const v1 = calcVelocity(shortTicks.slice(0, Math.floor(shortTicks.length / 2)));
  const v2 = calcVelocity(shortTicks.slice(Math.floor(shortTicks.length / 2)));
  const acceleration = v2 - v1; // d²P/dt²
  const short_persistence = calcPersistence(shortTicks);
  const short_reversal_rate = calcReversalRate(shortTicks);
  const short_volatility = calcVolatility(shortTicks);
  const shortHigh = Math.max(...shortTicks);
  const shortLow = Math.min(...shortTicks);
  const short_range = shortHigh - shortLow;
  const short_rangeCompression = short_range === 0 ? 0.5 : (shortTicks[shortTicks.length - 1] - shortLow) / short_range;

  // Medium (100 Ticks)
  const medium_momentum = calcMomentum(medTicks);
  const medium_velocity = calcVelocity(medTicks);
  const medium_reversal_rate = calcReversalRate(medTicks);
  const medium_volatility = calcVolatility(medTicks);
  const medium_displacement = Math.abs(medTicks[medTicks.length - 1] - medTicks[0]);
  const medHigh = Math.max(...medTicks);
  const medLow = Math.min(...medTicks);
  const medium_distHigh = medHigh - currentPrice;
  const medium_distLow = currentPrice - medLow;

  // Macro (300 Ticks)
  const macro_momentum = calcMomentum(macroTicks);
  const macro_volatility = calcVolatility(macroTicks);
  const macro_displacement = Math.abs(macroTicks[macroTicks.length - 1] - macroTicks[0]);
  const macro_regime = macro_momentum > 0.05 ? 1.0 : macro_momentum < -0.05 ? -1.0 : 0.0;

  // --- Temporal & Meta Metrics ---
  const is1Sec = symbol.startsWith('1HZ') || symbol.includes('1S') ? 1.0 : 0.0;
  const firstTickTs = ticks[0]?.timestamp || Date.now() - ticks.length * 1000;
  const lastTickTs = ticks[ticks.length - 1]?.timestamp || Date.now();
  const elapsedTimeSec = Math.max(1, (lastTickTs - firstTickTs) / 1000);

  const velocity_per_second = (currentPrice - ticks[0].price) / elapsedTimeSec;
  const ticks_per_second = totalCount / elapsedTimeSec;
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
    // 1-10: Price Behaviour
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

    // 11-19: Tick Pressure & Sequencing
    up_tick_ratio,
    down_tick_ratio,
    directional_imbalance,
    consecutive_up,
    consecutive_down,
    micro_persistence,
    short_persistence,
    short_reversal_rate,
    medium_reversal_rate,

    // 20-25: Tick Velocity & Acceleration
    micro_velocity,
    short_velocity,
    medium_velocity,
    acceleration,
    ticks_per_second,
    velocity_per_second,

    // 26-31: Short / Medium / Macro Volatility
    short_volatility,
    medium_volatility,
    macro_volatility,
    short_rangeCompression,
    medium_distHigh,
    medium_distLow,

    // 32-37: Contextual & Regime Metadata
    macro_regime,
    is1SecondSynthetic: is1Sec,
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
    // 1-10: Price Behaviour
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

    // 11-19: Tick Pressure & Sequencing
    features.up_tick_ratio,
    features.down_tick_ratio,
    features.directional_imbalance,
    features.consecutive_up,
    features.consecutive_down,
    features.micro_persistence,
    features.short_persistence,
    features.short_reversal_rate,
    features.medium_reversal_rate,

    // 20-25: Tick Velocity & Acceleration
    features.micro_velocity,
    features.short_velocity,
    features.medium_velocity,
    features.acceleration,
    features.ticks_per_second,
    features.velocity_per_second,

    // 26-31: Short / Medium / Macro Volatility
    features.short_volatility,
    features.medium_volatility,
    features.macro_volatility,
    features.short_rangeCompression,
    features.medium_distHigh,
    features.medium_distLow,

    // 32-37: Contextual & Regime Metadata
    features.macro_regime,
    features.is1SecondSynthetic,
    features.contractDurationSecs,
    features.durationFactor,
    features.digitFrequency,
    features.assetCategory,
  ];
}

