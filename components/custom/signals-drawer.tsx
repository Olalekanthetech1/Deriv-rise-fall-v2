'use client';

import { useState, useEffect } from 'react';
import {
  Radio,
  X,
  TrendingUp,
  TrendingDown,
  Activity,
  Sparkles,
  Zap,
  Volume2,
  VolumeX,
  CheckCircle2,
  Sliders,
  ShieldCheck,
  Clock,
  Target,
  Layers,
  Cpu,
  BrainCircuit,
  RefreshCw,
} from 'lucide-react';
import type { ActiveSymbol } from '@deriv/core';
import type { TradeSignal, DurationPrediction } from '@/hooks/use-realtime-signals';
import { MultiModelEvaluationCard } from './multi-model-evaluation-card';
import { EnsembleEvaluationResult } from '@/lib/multi-model-evaluator';

interface SignalsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSymbol: ActiveSymbol | null;
  signals: TradeSignal[];
  soundEnabled: boolean;
  onToggleSound: () => void;
  winStats: {
    total: number;
    winCount: number;
    accuracy: string;
  };
  onAutoFillTrade: (signal: TradeSignal) => void;
  onQuickExecute: (signal: TradeSignal) => Promise<void>;
  isBuying?: boolean;
}

export function SignalsDrawer({
  isOpen,
  onClose,
  activeSymbol,
  signals,
  soundEnabled,
  onToggleSound,
  winStats,
  onAutoFillTrade,
  onQuickExecute,
  isBuying = false,
}: SignalsDrawerProps) {
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [selectedDurationFilter, setSelectedDurationFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'signals' | 'multimodel'>('signals');
  const [ensembleData, setEnsembleData] = useState<EnsembleEvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && activeTab === 'multimodel') {
      fetchEnsembleData();
    }
  }, [isOpen, activeTab, activeSymbol]);

  const fetchEnsembleData = async () => {
    setIsEvaluating(true);
    try {
      const sym = activeSymbol?.underlying_symbol || 'R_100';
      const res = await fetch('/api/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: sym,
          durationSecs: 5,
          assetCategory: sym.startsWith('FRX') ? 1 : 0,
        }),
      });
      const data = await res.json();
      if (data.multiModelEnsemble) {
        setEnsembleData(data.multiModelEnsemble);
      }
    } catch (err) {
      console.warn('[Ensemble Fetch Error]:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  if (!isOpen) return null;

  const handleQuickExecute = async (sig: TradeSignal) => {
    setExecutingId(sig.id);
    try {
      await onQuickExecute(sig);
    } finally {
      setExecutingId(null);
    }
  };

  const handleSelectDurationPrediction = (sig: TradeSignal, dur: DurationPrediction) => {
    const updatedSignal: TradeSignal = {
      ...sig,
      direction: dur.direction,
      confidence: dur.confidence,
      recommendedDurationValue: dur.value,
      recommendedDurationUnit: dur.unit,
      recommendedDurationLabel: dur.label,
      winRate: dur.winRate,
    };
    onAutoFillTrade(updatedSignal);
  };

  const durationFilterOptions = [
    { id: 'ALL', label: 'All Durations' },
    { id: '5t', label: '5 Ticks' },
    { id: '10t', label: '10 Ticks' },
    { id: '1m', label: '1 Min' },
    { id: '5m', label: '5 Min' },
    { id: '1h', label: '1 Hour' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Sheet Modal Container */}
      <div className="relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#0a0f1d] border border-white/10 p-5 shadow-2xl space-y-4 max-h-[88vh] overflow-y-auto scrollbar-none">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-cyan-400 opacity-75"></span>
              <Radio className="w-5 h-5 text-cyan-400 relative" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Real-Time Trading Radar
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-gray-400">
                Tick stream ML neural heuristics &amp; volatility engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Toggle */}
            <button
              type="button"
              onClick={onToggleSound}
              title={soundEnabled ? 'Alert chime enabled' : 'Muted'}
              className={`p-2 rounded-xl border transition-all ${
                soundEnabled
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20'
                  : 'bg-white/5 border-white/10 text-gray-500 hover:text-gray-300'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Win-Rate Accuracy Banner */}
        <div className="p-3 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900 border border-indigo-500/20 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-indigo-200">
                Historical Signal Precision
              </div>
              <div className="text-[11px] text-gray-400">
                {winStats.winCount} Wins / {winStats.total} Signals Verified
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-black text-emerald-400 font-mono tracking-tight">
              {winStats.accuracy}
            </div>
            <div className="text-[10px] text-emerald-300/80 font-medium">Win Rate</div>
          </div>
        </div>

        {/* Active Asset Info Bar */}
        <div className="text-xs text-muted-foreground flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>
              Asset:{' '}
              <strong className="text-white">
                {activeSymbol?.underlying_symbol_name || 'Volatility 100 (1s) Index'}
              </strong>
            </span>
          </div>
          <span className="flex items-center gap-1 text-cyan-400 font-semibold text-[11px]">
            <Activity className="w-3.5 h-3.5" /> Tick Engine Active
          </span>
        </div>

        {/* Tab Switcher: Signals vs Multi-Model Evaluator */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-950 border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('signals')}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'signals'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>AI Trade Signals</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('multimodel')}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'multimodel'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-lg'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Multi-Model Layer</span>
          </button>
        </div>

        {activeTab === 'multimodel' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-400 font-medium">6 Modular AI Engines &amp; Regime Matrix</span>
              <button
                type="button"
                onClick={fetchEnsembleData}
                disabled={isEvaluating}
                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${isEvaluating ? 'animate-spin' : ''}`} />
                <span>Refresh Matrix</span>
              </button>
            </div>
            <MultiModelEvaluationCard ensemble={ensembleData} />
          </div>
        ) : (
          <>

        {/* Duration Matrix Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-[10px] font-bold text-gray-400 uppercase shrink-0 mr-1 flex items-center gap-1">
            <Layers className="w-3 h-3 text-cyan-400" /> Duration:
          </span>
          {durationFilterOptions.map((opt) => {
            const isActive = selectedDurationFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedDurationFilter(opt.id)}
                className={`px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                    : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Signal Cards List */}
        <div className="space-y-3">
          {signals.length === 0 ? (
            <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/5 space-y-2">
              <Radio className="w-8 h-8 text-gray-500 mx-auto animate-spin" />
              <p className="text-sm text-gray-300 font-medium">Scanning Live Tick Stream...</p>
              <p className="text-xs text-gray-500">
                Awaiting fresh tick volatility triggers from Deriv API.
              </p>
            </div>
          ) : (
            signals.map((sig) => {
              const isRise = sig.direction === 'RISE';
              const isHighConf = sig.confidence >= 88;
              const isExecThis = executingId === sig.id;

              return (
                <div
                  key={sig.id}
                  className={`p-3.5 rounded-2xl border transition-all space-y-3 ${
                    isHighConf
                      ? 'bg-gradient-to-b from-[#131b2e] to-[#0c1222] border-cyan-500/40 shadow-lg shadow-cyan-950/20 ring-1 ring-cyan-500/20'
                      : 'bg-[#101625] border-white/10 hover:border-white/20'
                  }`}
                >
                  {/* Top Row: Category, Name, Direction & Confidence */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sig.category === 'AI' && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-purple-400" /> AI Neural
                          </span>
                        )}
                        {sig.category === 'VOLATILITY' && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                            <Zap className="w-3 h-3 text-amber-400" /> Volatility
                          </span>
                        )}
                        {sig.category === 'SENTIMENT' && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                            <Activity className="w-3 h-3 text-cyan-400" /> Sentiment
                          </span>
                        )}
                        <span className="text-xs font-bold text-white tracking-wide">
                          {sig.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 line-clamp-1">
                        {sig.description}
                      </p>
                    </div>

                    {/* Direction Badge */}
                    <div className="flex flex-col items-end gap-1">
                      <div
                        className={`px-2.5 py-1 rounded-xl text-xs font-black flex items-center gap-1.5 border shadow-sm ${
                          isRise
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        }`}
                      >
                        {isRise ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                        <span>{sig.direction}</span>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-300/90 font-bold">
                        {sig.confidence}% Conf.
                      </span>
                    </div>
                  </div>

                  {/* Multi-Duration Prediction Matrix Bar */}
                  {sig.durationMatrix && sig.durationMatrix.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-extrabold uppercase text-gray-400 tracking-wider flex items-center justify-between">
                        <span>Predicted Horizon Matrix</span>
                        <span className="text-cyan-400 font-normal">Tap duration to select</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {sig.durationMatrix.map((dur) => {
                          const isDurRise = dur.direction === 'RISE';
                          const isRecommended =
                            sig.recommendedDurationValue === dur.value &&
                            sig.recommendedDurationUnit === dur.unit;

                          return (
                            <button
                              key={`${dur.value}${dur.unit}`}
                              type="button"
                              onClick={() => handleSelectDurationPrediction(sig, dur)}
                              className={`p-1.5 rounded-xl text-center border transition-all flex flex-col items-center justify-center ${
                                isRecommended
                                  ? 'bg-cyan-500/20 border-cyan-400 text-white ring-1 ring-cyan-400/50'
                                  : 'bg-black/30 border-white/5 text-gray-300 hover:border-white/20 hover:bg-white/5'
                              }`}
                            >
                              <div className="text-[10px] font-bold tracking-tight text-gray-200">
                                {dur.label}
                              </div>
                              <div
                                className={`text-[10px] font-black flex items-center gap-0.5 ${
                                  isDurRise ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {isDurRise ? (
                                  <TrendingUp className="w-2.5 h-2.5" />
                                ) : (
                                  <TrendingDown className="w-2.5 h-2.5" />
                                )}
                                <span>{dur.confidence}%</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Parameter Details: Duration, Target, Countdown */}
                  <div className="grid grid-cols-3 gap-2 p-2 rounded-xl bg-black/40 border border-white/5 text-[11px]">
                    <div className="flex items-center gap-1 text-gray-300">
                      <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <div>
                        <div className="text-[9px] text-gray-400 uppercase">Rec. Duration</div>
                        <div className="font-bold text-white">{sig.recommendedDurationLabel}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-gray-300">
                      <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <div>
                        <div className="text-[9px] text-gray-400 uppercase">Target Level</div>
                        <div className="font-bold font-mono text-white">
                          {sig.targetBarrier || 'Market'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-gray-300 justify-end text-right">
                      <div>
                        <div className="text-[9px] text-gray-400 uppercase">Signal Expiry</div>
                        <div className="font-bold font-mono text-cyan-400">
                          {sig.expiresInSeconds || 0}s
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Signal Validity Countdown Bar */}
                  <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-cyan-400 h-full transition-all duration-1000 ease-linear rounded-full"
                      style={{
                        width: `${((sig.expiresInSeconds || 0) / (sig.maxExpirySeconds || 1)) * 100}%`,
                      }}
                    />
                  </div>

                  {/* One-Tap Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {/* Auto-Fill Setup */}
                    <button
                      type="button"
                      onClick={() => onAutoFillTrade(sig)}
                      className="w-full py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-all border border-white/10 flex items-center justify-center gap-1.5"
                    >
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                      Auto-Fill Form
                    </button>

                    {/* Quick Trade Buy */}
                    <button
                      type="button"
                      disabled={isBuying || isExecThis}
                      onClick={() => handleQuickExecute(sig)}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-extrabold transition-all border flex items-center justify-center gap-1.5 shadow-md ${
                        isRise
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/30'
                          : 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400/30'
                      }`}
                    >
                      {isExecThis ? (
                        <>
                          <Radio className="w-3.5 h-3.5 animate-spin" /> Placing Trade...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Execute {sig.direction}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

