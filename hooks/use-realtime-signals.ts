'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ActiveSymbol, Tick } from '@deriv/core';

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
  confidence: number; // e.g. 92.4
  strength: 'Strong Buy' | 'Buy' | 'Strong Sell' | 'Sell' | 'Neutral';
  recommendedDurationValue: number; // e.g. 5 or 1
  recommendedDurationUnit: 't' | 'm' | 'h'; // 't' = ticks, 'm' = minutes, 'h' = hours
  recommendedDurationLabel: string; // e.g. "5 Ticks" or "1 Min"
  durationMatrix?: DurationPrediction[];
  targetBarrier?: string; // Target level
  expiresInSeconds: number; // Countdown
  maxExpirySeconds: number;
  winRate: string; // e.g. "89.4%"
  description: string;
  timestamp: number;
}

interface SignalWinStats {
  total: number;
  winCount: number;
  accuracy: string;
}

export function useRealtimeSignals(
  activeSymbol: ActiveSymbol | null,
  currentTick: Tick | null,
  prices: number[],
  durationValue: number = 5,
  durationUnit: string = 't'
) {
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [winStats, setWinStats] = useState<SignalWinStats>({
    total: 0,
    winCount: 0,
    accuracy: '0.0%',
  });

  const lastTickQuoteRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Helper to play synthesized audio alert for high confidence signals
  const playAlertSound = useCallback(() => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextClass();
      }

      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

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
      // Audio playback blocked or unallowed without user gesture
    }
  }, [soundEnabled]);

  // Generate dynamic signals from Option A Next.js API Route (/api/signals/predict)
  useEffect(() => {
    if (!activeSymbol || !currentTick?.quote || prices.length < 5) return;

    const currentQuote = currentTick.quote;
    if (lastTickQuoteRef.current === currentQuote) return;
    lastTickQuoteRef.current = currentQuote;

    const symbolKey = activeSymbol.underlying_symbol;
    const pipSize = activeSymbol.pip_size ?? 0.01;
    const tickObjects = prices.map((price, idx) => ({
      price,
      timestamp: Date.now() - (prices.length - idx) * 1000,
    }));

    let isSubscribed = true;

    async function fetchOptionASignals() {
      try {
        const res = await fetch('/api/signals/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: symbolKey,
            ticks: tickObjects,
            pipSize,
            durationValue,
            durationUnit,
          }),
        });

        if (!res.ok) return;
        const data = await res.json();
        if (!isSubscribed || !data.success || !Array.isArray(data.signals)) return;

        const apiSignals: TradeSignal[] = data.signals;

        if (data.winStats) {
          setWinStats(data.winStats);
        }

        setSignals((prev) => {
          return apiSignals.map((newSig) => {
            const existing = prev.find((s) => s.id === newSig.id);
            if (existing && existing.expiresInSeconds > 0) {
              // Lock active signal during its lifespan so direction stays consistent
              return existing;
            }
            return newSig;
          });
        });

        const topSignal = apiSignals[0];
        if (topSignal && topSignal.confidence >= 90) {
          playAlertSound();
        }
      } catch (err) {
        console.warn('[Realtime Signal Fetch Warning]:', err);
      }
    }

    fetchOptionASignals();

    return () => {
      isSubscribed = false;
    };
  }, [activeSymbol, currentTick, prices, durationValue, durationUnit, playAlertSound]);

  // Live countdown timer loop for active signals
  useEffect(() => {
    if (signals.length === 0) return;

    const interval = setInterval(() => {
      setSignals((prev) =>
        prev.map((sig) => {
          if (sig.expiresInSeconds <= 0) {
            return sig; // Leave at 0 so the API fetch can replace it
          }
          return {
            ...sig,
            expiresInSeconds: sig.expiresInSeconds - 1,
          };
        })
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [signals.length]);

  const highConfidenceCount = useMemo(() => {
    return signals.filter((s) => s.confidence >= 85).length;
  }, [signals]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => !prev);
  }, []);

  return {
    signals,
    highConfidenceCount,
    soundEnabled,
    toggleSound,
    winStats,
  };
}
