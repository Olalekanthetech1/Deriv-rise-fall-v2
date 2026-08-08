'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProposalInfo, DerivWS, ActiveSymbol, AuthState } from '@deriv/core';
import type { Direction, DurationSelectUnit, DurationOption } from '@/lib/types';
import { calculateDynamicOptimalDuration } from '@/lib/duration-utils';
import { PayoutInfoCard } from './payout-info-card';
import { DerivTradeConfigFields } from './deriv-trade-config-fields';
import { TickSentimentBar } from './tick-sentiment-bar';
import { tradeStrategyStore } from '@/lib/trade-store';

interface ProModeControlsProps {
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
  duration: number;
  onDurationChange: (val: number) => void;
  durationUnit: DurationSelectUnit;
  onDurationUnitChange: (unit: DurationSelectUnit) => void;
  durationOptions: DurationOption[];
  endDate?: Date;
  onEndDateChange?: (date: Date | undefined) => void;
  endTime?: string;
  onEndTimeChange?: (time: string) => void;
  ws?: DerivWS | null;
  activeSymbol: ActiveSymbol | null;
  prices?: number[];
}

export function ProModeControls({
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
  duration,
  onDurationChange,
  durationUnit,
  onDurationUnitChange,
  durationOptions,
  endDate,
  onEndDateChange,
  endTime,
  onEndTimeChange,
  ws,
  activeSymbol,
  prices,
}: ProModeControlsProps) {
  const [isAnalyzingAi, setIsAnalyzingAi] = useState(false);
  const [isAutoDuration, setIsAutoDuration] = useState(false);
  const [multiContractMultiplier, setMultiContractMultiplier] = useState(1);
  const [isBatchExecuting, setIsBatchExecuting] = useState(false);

  // Multi-contract execution is deliberately sequential. Each onBuy call now
  // requests a fresh one-shot proposal immediately before buying, preventing
  // proposal reuse and avoiding concurrent buy-state races.
  const executeBatchTrade = async (targetDir: Direction) => {
    if (isBatchExecuting || isBuying) return;

    let executionDuration = duration;
    let executionUnit = durationUnit;

    if (isAutoDuration) {
      const optimal = calculateDynamicOptimalDuration(durationOptions, activeSymbol);
      executionDuration = optimal.duration;
      executionUnit = optimal.unit;
      onDurationChange(executionDuration);
      onDurationUnitChange(executionUnit);
    }

    const count = multiContractMultiplier;
    if (count <= 1) {
      await onBuy(targetDir);
      return;
    }

    setIsBatchExecuting(true);
    toast.info(`Batch Executing ${count}x Contracts...`, {
      description: `Submitting ${count} independent ${targetDir === 'CALL' ? 'RISE' : 'FALL'} orders at $${stake} each.`,
    });

    let successful = 0;
    const errors: string[] = [];

    try {
      for (let i = 0; i < count; i += 1) {
        try {
          await onBuy(targetDir);
          successful += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown execution error';
          errors.push(`Contract ${i + 1}: ${message}`);
          // Continue the remaining contracts so a transient proposal/buy
          // failure does not silently cancel the rest of the requested batch.
        }
      }

      if (successful === count) {
        toast.success(`Batch complete: ${successful}/${count} contracts purchased`, {
          description: `Total stake: $${(Number(stake) * count).toFixed(2)}.` ,
        });
      } else if (successful > 0) {
        toast.warning(`Partial batch: ${successful}/${count} contracts purchased`, {
          description: errors[0] || 'One or more contracts could not be purchased.',
        });
      } else {
        toast.error(`Batch failed: 0/${count} contracts purchased`, {
          description: errors[0] || 'No contracts were purchased.',
        });
      }
    } finally {
      setIsBatchExecuting(false);
    }
  };

  // Instant execution for Rise
  const handleRiseClick = () => {
    if (authState !== 'authenticated') {
      toast.error('Authentication Required', {
        description: 'Please log in to your Deriv account to execute live trades.',
      });
      return;
    }
    onDirectionChange('CALL');
    tradeStrategyStore.setStrategy('Manual');
    void executeBatchTrade('CALL').catch((error) => {
      toast.error('Rise execution failed', {
        description: error instanceof Error ? error.message : 'Unable to execute the trade.',
      });
    });
  };

  // Instant execution for Fall
  const handleFallClick = () => {
    if (authState !== 'authenticated') {
      toast.error('Authentication Required', {
        description: 'Please log in to your Deriv account to execute live trades.',
      });
      return;
    }
    onDirectionChange('PUT');
    tradeStrategyStore.setStrategy('Manual');
    void executeBatchTrade('PUT').catch((error) => {
      toast.error('Fall execution failed', {
        description: error instanceof Error ? error.message : 'Unable to execute the trade.',
      });
    });
  };

  // AI Trading auto-signal button execution
  const handleAiTradingClick = async () => {
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
    setIsAnalyzingAi(true);
    toast.info('AI Model Analyzing...', {
      description: `Evaluating market features for ${activeSymbol?.underlying_symbol_name || 'active symbol'}`,
      icon: <Sparkles className="h-4 w-4 text-cyan-400 animate-spin" />,
    });

    try {
      const res = await fetch('/api/signals/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activeSymbol?.underlying_symbol || 'R_100',
          durationValue: duration,
          durationUnit: durationUnit,
          pipSize: (activeSymbol as any)?.pip || 0.01
        }),
      });

      const data = await res.json();
      
      if (!data.success || !data.signals || data.signals.length === 0) {
        throw new Error(data.error || 'Failed to generate AI signals');
      }

      // Sort signals by confidence (descending) and pick the top one
      const bestSignal = [...data.signals].sort((a, b) => b.confidence - a.confidence)[0];
      
      setIsAnalyzingAi(false);

      const aiDirection: Direction = bestSignal.direction === 'RISE' ? 'CALL' : 'PUT';
      const confidence = bestSignal.confidence;
      const modelName = bestSignal.name;

      onDirectionChange(aiDirection);
      tradeStrategyStore.setStrategy(modelName);
      toast.success(`${modelName}: ${bestSignal.direction} (${confidence}% Confidence)`, {
        description: `Executing ${multiContractMultiplier > 1 ? `${multiContractMultiplier}x batch ` : ''}automated AI contract with ${stake} USD stake...`,
      });

      await executeBatchTrade(aiDirection);
    } catch (err: any) {
      setIsAnalyzingAi(false);
      toast.error(`AI Analysis Failed`, {
        description: err.message || 'System lacked sufficient data to generate signal. Please wait for more ticks.'
      });
    }
  };

  const controlsDisabled = !isConnected || isBuying || isBatchExecuting || isAnalyzingAi;

  return (
    <div className="w-full space-y-4">
      {/* Live AI Tick Sentiment Indicator */}
      <TickSentimentBar prices={prices} activeSymbol={activeSymbol} />

      {/* Payout & Profit Card */}
      <PayoutInfoCard proposal={proposal} stake={stake} />

      {/* Standard Deriv Trade Configurations (Allow Equals, Stake, Duration) */}
      <DerivTradeConfigFields
        allowEquals={allowEquals}
        onAllowEqualsChange={onAllowEqualsChange}
        stake={stake}
        onStakeChange={onStakeChange}
        duration={duration}
        onDurationChange={onDurationChange}
        durationUnit={durationUnit}
        onDurationUnitChange={onDurationUnitChange}
        durationOptions={durationOptions}
        isAutoDuration={isAutoDuration}
        onAutoDurationChange={setIsAutoDuration}
        multiContractMultiplier={multiContractMultiplier}
        onMultiContractMultiplierChange={setMultiContractMultiplier}
        endDate={endDate}
        onEndDateChange={onEndDateChange}
        endTime={endTime}
        onEndTimeChange={onEndTimeChange}
        ws={ws}
        isConnected={isConnected}
        activeSymbol={activeSymbol}
        prices={prices}
        showMultiContract={true}
      />

      {/* Main Pro Action Controls Row at the BOTTOM (Rise, AI Trading, Fall) */}
      <div className="pt-2 border-t border-border/50 grid grid-cols-[1fr_2fr_1fr] gap-2.5 items-center">
        {/* RISE Button */}
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={handleRiseClick}
          className="h-16 rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 active:scale-95 transition-all duration-150 flex items-center justify-center shadow-lg shadow-emerald-950/40 border border-emerald-400/30 group disabled:opacity-50"
        >
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <ArrowUpRight className="w-5 h-5 text-white stroke-[3]" />
            </div>
            <span className="text-[10px] font-bold text-white uppercase tracking-tight mt-0.5">Rise</span>
          </div>
        </button>

        {/* AI TRADING Button */}
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={handleAiTradingClick}
          className="relative h-16 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 active:scale-[0.98] transition-all duration-200 flex items-center justify-center px-3 shadow-xl shadow-cyan-500/25 border border-cyan-300/40 group overflow-hidden disabled:opacity-50"
        >
          {/* Glowing animated halo */}
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/20 via-blue-400/30 to-purple-500/20 animate-pulse pointer-events-none" />

          <div className="relative flex items-center gap-2.5 z-10">
            <div className="w-9 h-9 rounded-full bg-white text-blue-600 font-black flex items-center justify-center text-xs tracking-tight shadow-md border border-white/50 shrink-0">
              {isAnalyzingAi ? (
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              ) : (
                <span className="font-extrabold text-[13px] bg-gradient-to-r from-blue-600 to-indigo-700 bg-clip-text text-transparent">AI</span>
              )}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-sm font-extrabold tracking-wider text-white uppercase drop-shadow-sm flex items-center gap-1">
                TRADING
                <Sparkles className="w-3.5 h-3.5 text-cyan-200 animate-bounce" />
              </span>
              <span className="text-[10px] text-cyan-100/90 font-medium tracking-tight">
                {isAnalyzingAi ? 'AI Signal...' : 'Auto-Signal Entry'}
              </span>
            </div>
          </div>
        </button>

        {/* FALL Button */}
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={handleFallClick}
          className="h-16 rounded-2xl bg-gradient-to-b from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 active:scale-95 transition-all duration-150 flex items-center justify-center shadow-lg shadow-rose-950/40 border border-rose-400/30 group disabled:opacity-50"
        >
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <ArrowDownRight className="w-5 h-5 text-white stroke-[3]" />
            </div>
            <span className="text-[10px] font-bold text-white uppercase tracking-tight mt-0.5">Fall</span>
          </div>
        </button>
      </div>
    </div>
  );
}
