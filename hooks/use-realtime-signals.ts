'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ActiveSymbol, Tick } from '@deriv/core';
import type { SignalConsensus, SignalModeRecommendation } from '@/lib/signal-manager';

export interface DurationPrediction {
  value: number;
  unit: 't' | 'm' | 'h';
  label: string;
  direction: 'RISE' | 'FALL';
  confidence: number;
  winRate: string;
}

export interface TradeSignal {
  id: string;
  name: string;
  category: 'AI' | 'TECHNICAL' | 'VOLATILITY' | 'SENTIMENT';
  direction: 'RISE' | 'FALL';
  confidence: number;
  strength: 'Strong Buy' | 'Buy' | 'Strong Sell' | 'Sell' | 'Neutral';
  recommendedDurationValue: number;
  recommendedDurationUnit: 't' | 'm' | 'h';
  recommendedDurationLabel: string;
  durationMatrix?: DurationPrediction[];
  targetBarrier?: string;
  expiresInSeconds: number;
  maxExpirySeconds: number;
  expiresAt: number;
  winRate: string;
  description: string;
  timestamp: number;
}

interface SignalWinStats {
  total: number;
  winCount: number;
  accuracy: string;
}

interface SignalApiResponse {
  success: boolean;
  error?: string;
  signals?: TradeSignal[];
  winStats?: SignalWinStats;
  consensus?: SignalConsensus;
  modeRecommendations?: SignalModeRecommendation[];
}

const MODEL_UNAVAILABLE_ERROR = 'NO_VALIDATED_TRAINED_MODELS_AVAILABLE';
const MODEL_RETRY_COOLDOWN_MS = 15_000;

export function useRealtimeSignals(
  activeSymbol: ActiveSymbol | null,
  currentTick: Tick | null,
  prices: number[],
  durationValue: number = 5,
  durationUnit: string = 't',
) {
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [consensus, setConsensus] = useState<SignalConsensus | null>(null);
  const [modeRecommendations, setModeRecommendations] = useState<SignalModeRecommendation[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [winStats, setWinStats] = useState<SignalWinStats>({ total: 0, winCount: 0, accuracy: '0.0%' });
  const lastTickQuoteRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const predictionInFlightRef = useRef(false);
  const modelRetryAfterRef = useRef(0);

  const playAlertSound = useCallback(() => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') audioCtxRef.current = new AudioContextClass();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // Browser audio may require an explicit user gesture.
    }
  }, [soundEnabled]);

  useEffect(() => {
    if (!activeSymbol || !currentTick?.quote || prices.length < 5) return;
    const currentQuote = currentTick.quote;
    if (lastTickQuoteRef.current === currentQuote) return;
    lastTickQuoteRef.current = currentQuote;

    const now = Date.now();
    if (now < modelRetryAfterRef.current || predictionInFlightRef.current) return;

    const symbolKey = activeSymbol.underlying_symbol;
    const pipSize = activeSymbol.pip_size ?? 0.01;
    const tickObjects = prices.map((price, idx) => ({ price, timestamp: Date.now() - (prices.length - idx) * 1000 }));
    let isSubscribed = true;
    predictionInFlightRef.current = true;

    async function fetchSignals() {
      try {
        const res = await fetch('/api/signals/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: symbolKey, ticks: tickObjects, pipSize, durationValue, durationUnit }),
        });
        const data = (await res.json().catch(() => ({}))) as SignalApiResponse;

        if (data?.error === MODEL_UNAVAILABLE_ERROR) {
          // Training/validation has not produced a production-eligible model yet.
          // Stop per-tick prediction polling and retry periodically instead of
          // flooding the API with an error that cannot succeed until model state changes.
          modelRetryAfterRef.current = Date.now() + MODEL_RETRY_COOLDOWN_MS;
          if (isSubscribed) {
            setSignals([]);
            setConsensus(null);
            setModeRecommendations([]);
          }
          return;
        }

        if (!res.ok) return;
        if (!isSubscribed || !data.success || !Array.isArray(data.signals)) return;

        modelRetryAfterRef.current = 0;
        if (data.winStats) setWinStats(data.winStats);
        if (data.consensus) setConsensus(data.consensus);
        if (Array.isArray(data.modeRecommendations)) setModeRecommendations(data.modeRecommendations);

        const responseNow = Date.now();
        setSignals((prev) => data.signals!.map((next) => {
          const existing = prev.find((s) => s.id === next.id);
          if (existing && existing.expiresAt > responseNow) return existing;
          return next;
        }));

        const currentConsensus = data.consensus;
        if (
          currentConsensus &&
          currentConsensus.direction !== 'WAIT' &&
          currentConsensus.confidence >= 90 &&
          currentConsensus.agreement >= 75
        ) {
          playAlertSound();
        }
      } catch (err) {
        console.warn('[Realtime Signal Fetch Warning]:', err);
      } finally {
        predictionInFlightRef.current = false;
      }
    }

    void fetchSignals();
    return () => {
      isSubscribed = false;
      predictionInFlightRef.current = false;
    };
  }, [activeSymbol, currentTick, prices, durationValue, durationUnit, playAlertSound]);

  useEffect(() => {
    if (!signals.length) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setSignals((prev) => prev.map((signal) => ({
        ...signal,
        expiresInSeconds: Math.max(0, Math.ceil((signal.expiresAt - now) / 1000)),
      })));
      setConsensus((prev) => prev ? {
        ...prev,
        expiresInSeconds: Math.max(0, Math.ceil((prev.expiresAt - now) / 1000)),
        status: prev.expiresAt <= now ? 'EXPIRED' : prev.expiresAt - now <= 10_000 ? 'EXPIRING' : 'ACTIVE',
      } : prev);
    }, 250);
    return () => window.clearInterval(interval);
  }, [signals.length]);

  const highConfidenceCount = useMemo(() => signals.filter((s) => s.confidence >= 85).length, [signals]);
  const toggleSound = useCallback(() => setSoundEnabled((prev) => !prev), []);

  return { signals, consensus, modeRecommendations, highConfidenceCount, soundEnabled, toggleSound, winStats };
}
