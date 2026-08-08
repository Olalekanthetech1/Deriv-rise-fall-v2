'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Minus, Plus, Play, Square, Sparkles, Cpu } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { ProposalInfo, DerivWS, ActiveSymbol, AuthState } from '@deriv/core';
import type { Direction, DurationSelectUnit, DurationOption } from '@/lib/types';
import { DerivTradeConfigFields } from './deriv-trade-config-fields';
import { TickSentimentBar } from './tick-sentiment-bar';
import { tradeStrategyStore } from '@/lib/trade-store';

interface AiTraderControlsProps {
  authState?: AuthState;
  onLogin?: () => void;
  proposal: ProposalInfo | null;
  stake: string;
  onStakeChange: (val: string) => void;
  direction: Direction;
  onDirectionChange: (dir: Direction) => void;
  allowEquals?: boolean;
  onAllowEqualsChange?: (val: boolean) => void;
  onBuy: (targetDir?: Direction) => Promise<void>;
  isBuying: boolean;
  isConnected: boolean;
  duration?: number;
  onDurationChange?: (val: number) => void;
  durationUnit?: DurationSelectUnit;
  onDurationUnitChange?: (unit: DurationSelectUnit) => void;
  durationOptions?: DurationOption[];
  endDate?: Date;
  onEndDateChange?: (date: Date | undefined) => void;
  endTime?: string;
  onEndTimeChange?: (time: string) => void;
  ws?: DerivWS | null;
  activeSymbol: ActiveSymbol | null;
  prices?: number[];
}

const NEXT_TRADE_DELAY_MS = 3500;

export function AiTraderControls({
  authState,
  onLogin,
  proposal,
  stake,
  onStakeChange,
  direction,
  onDirectionChange,
  allowEquals = false,
  onAllowEqualsChange,
  onBuy,
  isBuying,
  isConnected,
  duration = 1,
  onDurationChange,
  durationUnit = 't',
  onDurationUnitChange,
  durationOptions = [],
  endDate,
  onEndDateChange,
  endTime,
  onEndTimeChange,
  ws,
  activeSymbol,
  prices,
}: AiTraderControlsProps) {
  const [numTrades, setNumTrades] = useState<number>(10);
  const [strategy, setStrategy] = useState<string>('Flat Staking');

  // Automated execution state. The auto executor deliberately does NOT consume
  // the UI's AI Consensus Recommendation: consensus is advisory/manual only.
  const [isRunning, setIsRunning] = useState(false);
  const [currentTradeIndex, setCurrentTradeIndex] = useState(0);
  const [executionStats, setExecutionStats] = useState({ executed: 0, failed: 0 });
  const [lastExecution, setLastExecution] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef(0);

  const clearExecutionTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopSession = useCallback((showToast = false) => {
    clearExecutionTimer();
    sessionRef.current += 1;
    setIsRunning(false);
    if (showToast) {
      toast.info('AI Automated Trading Stopped', {
        description: 'No new automatic trades will be submitted.',
      });
    }
  }, [clearExecutionTimer]);

  useEffect(() => {
    return () => {
      clearExecutionTimer();
      sessionRef.current += 1;
    };
  }, [clearExecutionTimer]);

  const executeTrade = useCallback(async (sessionId: number, tradeNumber: number) => {
    if (sessionRef.current !== sessionId || !isRunning) return;

    if (authState !== 'authenticated') {
      stopSession();
      toast.error('AI Session Stopped', { description: 'Authentication is no longer active.' });
      return;
    }

    if (!isConnected) {
      stopSession();
      toast.error('AI Session Stopped', { description: 'Trading connection is no longer available.' });
      return;
    }

    setCurrentTradeIndex(tradeNumber);

    try {
      // This is the AUTO execution source. It intentionally uses the signal
      // prediction endpoint directly and never gates execution on the separate
      // AI Consensus Recommendation shown in the Signals drawer.
      const res = await fetch('/api/signals/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          symbol: activeSymbol?.underlying_symbol || 'R_100',
          durationValue: duration,
          durationUnit,
          pipSize: activeSymbol?.pip_size ?? 0.01,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !Array.isArray(data?.signals) || data.signals.length === 0) {
        throw new Error(typeof data?.error === 'string' ? data.error : `AI signal request failed (${res.status})`);
      }

      const candidates = data.signals.filter((signal: any) =>
        (signal?.direction === 'RISE' || signal?.direction === 'FALL') && Number.isFinite(Number(signal?.confidence)),
      );
      if (!candidates.length) throw new Error('AI service returned no executable direction.');

      const bestSignal = [...candidates].sort((a: any, b: any) => Number(b.confidence) - Number(a.confidence))[0];
      const targetDirection: Direction = bestSignal.direction === 'RISE' ? 'CALL' : 'PUT';
      const confidence = Number(bestSignal.confidence);

      // The actual Deriv purchase must complete before the next automatic
      // iteration is scheduled. This prevents overlapping buy/proposal requests
      // and, importantly, surfaces real execution failures to the user.
      await onBuy(targetDirection);

      if (sessionRef.current !== sessionId) return;

      setExecutionStats((prev) => ({ ...prev, executed: prev.executed + 1 }));
      setLastExecution(`${targetDirection === 'CALL' ? 'RISE ↑' : 'FALL ↓'} · ${confidence.toFixed(1)}%`);
      toast.success(`AI Trade #${tradeNumber}/${numTrades} Executed`, {
        description: `${targetDirection === 'CALL' ? 'RISE ↑' : 'FALL ↓'} | Signal confidence ${confidence.toFixed(1)}% | Stake $${stake}`,
      });

      if (tradeNumber >= numTrades) {
        stopSession();
        toast.success('AI Trading Session Complete', {
          description: `Submitted ${numTrades} automatic trades successfully.`,
        });
        return;
      }

      timerRef.current = setTimeout(() => {
        void executeTrade(sessionId, tradeNumber + 1);
      }, NEXT_TRADE_DELAY_MS);
    } catch (err) {
      if (sessionRef.current !== sessionId) return;

      const message = err instanceof Error ? err.message : 'Automatic trade execution failed.';
      setExecutionStats((prev) => ({ ...prev, failed: prev.failed + 1 }));
      stopSession();
      toast.error(`AI Trade #${tradeNumber} Failed`, {
        description: message,
      });
    }
  }, [activeSymbol, authState, duration, durationUnit, isConnected, isRunning, numTrades, onBuy, stake, stopSession]);

  const handleStartAiSession = useCallback(() => {
    if (authState !== 'authenticated') {
      toast.error('Authentication Required', {
        description: 'Please log in to your Deriv account to execute AI trades.',
      });
      return;
    }

    if (!isConnected) {
      toast.error('Not connected to Deriv trading server');
      return;
    }

    if (isRunning) {
      stopSession(true);
      return;
    }

    const numericStake = Number(stake);
    if (!Number.isFinite(numericStake) || numericStake <= 0) {
      toast.error('Invalid Stake', { description: 'Enter a valid stake before starting automated trading.' });
      return;
    }

    clearExecutionTimer();
    sessionRef.current += 1;
    const sessionId = sessionRef.current;

    setIsRunning(true);
    setCurrentTradeIndex(0);
    setExecutionStats({ executed: 0, failed: 0 });
    setLastExecution(null);
    tradeStrategyStore.setStrategy(`Auto (${strategy})`);

    toast.success('Dynamic AI Auto-Trader Activated', {
      description: `Execution source: AI signal prediction | ${numTrades} trades @ $${numericStake.toFixed(2)} base stake`,
      icon: <Sparkles className="h-4 w-4 text-purple-400" />,
    });

    // Start only after state has been committed on the next event-loop turn.
    timerRef.current = setTimeout(() => {
      void executeTrade(sessionId, 1);
    }, 0);
  }, [authState, clearExecutionTimer, executeTrade, isConnected, isRunning, numTrades, stake, stopSession, strategy]);

  return (
    <div className="w-full space-y-4">
      <TickSentimentBar prices={prices} activeSymbol={activeSymbol} />

      <div className="rounded-2xl bg-gradient-to-r from-purple-950/80 via-slate-900 to-indigo-950/80 border border-purple-500/30 p-3 shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300">
            <Cpu className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              Dynamic AI Ensemble <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/30 text-purple-300 font-mono">v4.1</span>
            </div>
            <div className="text-[11px] text-purple-200/70 font-medium">
              {isRunning ? `Executing Trade ${currentTradeIndex}/${numTrades}...` : 'Ready for algorithmic execution'}
            </div>
          </div>
        </div>

        {isRunning && (
          <div className="text-right">
            <div className="text-[10px] text-gray-400 uppercase font-semibold">EXECUTION</div>
            <div className="text-xs font-bold text-emerald-400">
              {executionStats.executed} OK / {executionStats.failed} Failed
            </div>
          </div>
        )}
      </div>

      {lastExecution && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-200">
          Last submitted: <span className="font-bold">{lastExecution}</span>
        </div>
      )}

      <DerivTradeConfigFields
        allowEquals={allowEquals}
        onAllowEqualsChange={onAllowEqualsChange}
        stake={stake}
        onStakeChange={onStakeChange}
        duration={duration}
        onDurationChange={onDurationChange || (() => {})}
        durationUnit={durationUnit}
        onDurationUnitChange={onDurationUnitChange || (() => {})}
        durationOptions={durationOptions}
        endDate={endDate}
        onEndDateChange={onEndDateChange}
        endTime={endTime}
        onEndTimeChange={onEndTimeChange}
        ws={ws}
        isConnected={isConnected}
        activeSymbol={activeSymbol}
        prices={prices}
      />

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Number of trades</Label>
          <div className="flex items-center rounded-xl bg-card border border-border overflow-hidden h-10 shadow-sm">
            <button type="button" disabled={isRunning} onClick={() => setNumTrades(Math.max(1, numTrades - 1))} className="w-10 h-full flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground active:bg-muted/80 transition-colors">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="flex-1 text-center text-sm font-bold text-foreground">{numTrades}</span>
            <button type="button" disabled={isRunning} onClick={() => setNumTrades(numTrades + 1)} className="w-10 h-full flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground active:bg-muted/80 transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Strategy</Label>
          <Select disabled={isRunning} value={strategy} onValueChange={setStrategy}>
            <SelectTrigger className="h-10 rounded-xl bg-card border-border text-xs font-medium"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Anti-Martingale">Anti-Martingale</SelectItem>
              <SelectItem value="Martingale">Martingale</SelectItem>
              <SelectItem value="D'Alembert">D'Alembert</SelectItem>
              <SelectItem value="Oscar's Grind">Oscar's Grind</SelectItem>
              <SelectItem value="Flat Staking">Flat Staking</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] leading-relaxed text-amber-200/80">
        Auto execution uses the live AI signal prediction directly. The separate AI Consensus Recommendation is advisory for manual trading and does not block automatic execution.
      </div>

      <div className="pt-2">
        <button
          type="button"
          disabled={!isConnected || isBuying}
          onClick={handleStartAiSession}
          className={`w-full h-12 rounded-xl font-black text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg transition-all duration-200 active:scale-95 ${
            isRunning
              ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-950/50'
              : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-purple-900/30 border border-purple-400/30'
          }`}
        >
          {isRunning ? (
            <><Square className="w-4 h-4 fill-current" /><span>STOP AUTOMATED AI TRADING</span></>
          ) : (
            <><span>START AI AUTOMATED TRADING</span><div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center"><Play className="w-3.5 h-3.5 fill-current ml-0.5" /></div></>
          )}
        </button>
      </div>
    </div>
  );
}
