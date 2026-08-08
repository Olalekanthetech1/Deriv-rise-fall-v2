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
  signals?: TradeSignal[];
  winStats?: SignalWinStats;
  consensus?: SignalConsensus;
  modeRecommendations?: SignalModeRecommendation[];
}

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

    const symbolKey = activeSymbol.underlying_symbol;
    const pipSize = activeSymbol.pip_size ?? 0.01;
    const tickObjects = prices.map((price, idx) => ({ price, timestamp: Date.now() - (prices.length - idx) * 1000 }));
    let isSubscribed = true;

    async function fetchSignals() {
      try {
        const res = await fetch('/api/signals/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: symbolKey, ticks: tickObjects, pipSize, durationValue, durationUnit }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as SignalApiResponse;
        if (!isSubscribed || !data.success || !Array.isArray(data.signals)) return;

        if (data.winStats) setWinStats(data.winStats);
        if (data.consensus) setConsensus(data.consensus);
        if (Array.isArray(data.modeRecommendations)) setModeRecommendations(data.modeRecommendations);

        const now = Date.now();
        setSignals((prev) => data.signals!.map((next) => {
          const existing = prev.find((s) => s.id === next.id);
          if (existing && existing.expiresAt > now) return existing;
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
      }
    }

    void fetchSignals();
    return () => { isSubscribed = false; };
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