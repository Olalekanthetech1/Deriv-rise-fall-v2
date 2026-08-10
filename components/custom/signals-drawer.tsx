'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock, Cpu, Layers, Radio, RefreshCw, ShieldCheck, Sliders, Sparkles, Target, TrendingDown, TrendingUp, Volume2, VolumeX, X, Zap } from 'lucide-react';
import type { ActiveSymbol } from '@deriv/core';
import type { DurationPrediction, TradeSignal } from '@/hooks/use-realtime-signals';
import type { SignalConsensus, SignalModeRecommendation } from '@/lib/signal-manager';
import type { MultiModelEvaluationResult } from '@/lib/multi-model-ui-types';
import { MultiModelEvaluationCard } from './multi-model-evaluation-card';

interface SignalsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSymbol: ActiveSymbol | null;
  signals: TradeSignal[];
  consensus: SignalConsensus | null;
  modeRecommendations: SignalModeRecommendation[];
  soundEnabled: boolean;
  onToggleSound: () => void;
  winStats: { total: number; winCount: number; accuracy: string };
  onAutoFillTrade: (signal: TradeSignal) => void;
  onQuickExecute: (signal: TradeSignal) => Promise<void>;
  isBuying?: boolean;
}

function formatExpiry(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

export function SignalsDrawer({ isOpen, onClose, activeSymbol, signals, consensus, modeRecommendations, soundEnabled, onToggleSound, winStats, onAutoFillTrade, onQuickExecute, isBuying = false }: SignalsDrawerProps) {
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'signals' | 'multimodel'>('signals');
  const [selectedDurationFilter, setSelectedDurationFilter] = useState('ALL');
  const [ensembleData, setEnsembleData] = useState<MultiModelEvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [ensembleError, setEnsembleError] = useState<string | null>(null);

  const consensusDuration = useMemo(() => consensus?.recommendedDuration ?? null, [consensus]);

  const fetchEnsembleData = async () => {
    setIsEvaluating(true);
    setEnsembleError(null);
    try {
      const symbol = activeSymbol?.underlying_symbol || 'R_100';
      const durationValue = consensusDuration?.value ?? 5;
      const durationUnit = consensusDuration?.unit === 'm' || consensusDuration?.unit === 'h' ? consensusDuration.unit : 't';
      const response = await fetch('/api/ml/predict', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({
          symbol,
          durationSecs: Math.max(1, durationUnit === 'm' ? durationValue * 60 : durationUnit === 'h' ? durationValue * 3600 : durationValue),
          durationValue,
          durationUnit,
          assetCategory: symbol.startsWith('FRX') ? 1 : 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success !== true || !data?.multiModelEnsemble) throw new Error(typeof data?.error === 'string' ? data.error : `Multi-Model evaluation request failed (${response.status})`);
      setEnsembleData(data.multiModelEnsemble as MultiModelEvaluationResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load Multi-Model evaluation.';
      console.warn('[Ensemble Fetch Error]:', error); setEnsembleError(message); setEnsembleData(null);
    } finally { setIsEvaluating(false); }
  };

  useEffect(() => { if (isOpen && activeTab === 'multimodel') void fetchEnsembleData(); }, [isOpen, activeTab, activeSymbol, consensusDuration]);
  if (!isOpen) return null;

  const handleQuickExecute = async (signal: TradeSignal) => {
    setExecutingId(signal.id);
    try { await onQuickExecute(signal); } finally { setExecutingId(null); }
  };

  const handleSelectDurationPrediction = (signal: TradeSignal, duration: DurationPrediction) => {
    onAutoFillTrade({ ...signal, direction: duration.direction, confidence: duration.confidence, recommendedDurationValue: duration.value, recommendedDurationUnit: duration.unit, recommendedDurationLabel: duration.label, winRate: duration.winRate });
  };

  const durationOptions = [
    { id: 'ALL', label: 'All Durations' }, { id: '1t', label: '1 Tick' }, { id: '5t', label: '5 Ticks' }, { id: '10t', label: '10 Ticks' },
    { id: '1m', label: '1 Min' }, { id: '2m', label: '2 Min' }, { id: '5m', label: '5 Min' }, { id: '15m', label: '15 Min' }, { id: '1h', label: '1 Hour' },
  ];

  const visibleSignals = selectedDurationFilter === 'ALL' ? signals : signals.filter((signal) => signal.recommendedDurationValue === Number(selectedDurationFilter.replace(/[^0-9]/g, '')) && signal.recommendedDurationUnit === (selectedDurationFilter.replace(/[0-9]/g, '') || 't'));
  const modeLabel: Record<string, string> = { CLASSIC: 'Classic', PRO: 'Pro', AI: 'AI Trader' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4">
      <button aria-label="Close signals" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative z-10 max-h-[88vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0a0f1d] p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5"><Radio className="h-5 w-5 text-cyan-400" /><div><div className="flex items-center gap-2"><h2 className="text-base font-bold text-white">Real-Time Trading Radar</h2><span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-cyan-300">LIVE</span></div><p className="text-[11px] text-gray-400">Unified AI signal manager &amp; multi-model radar</p></div></div>
          <div className="flex items-center gap-2"><button type="button" onClick={onToggleSound} className="rounded-xl border border-white/10 bg-white/5 p-2 text-gray-300">{soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-gray-400 hover:text-white"><X className="h-4 w-4" /></button></div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-indigo-500/20 bg-indigo-950/40 p-3"><div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-indigo-400" /><div><div className="text-xs font-semibold text-indigo-200">Verified Trade Outcomes</div><div className="text-[11px] text-gray-400">{winStats.winCount} Wins / {winStats.total} Resolved Contracts</div></div></div><div className="text-right text-base font-black text-emerald-400">{winStats.accuracy}</div></div>

        {consensus && (
          <div className={`space-y-3 rounded-2xl border p-4 ${consensus.direction === 'WAIT' ? 'border-amber-500/30 bg-amber-950/20' : consensus.direction === 'RISE' ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-rose-500/30 bg-rose-950/20'}`}>
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-black uppercase tracking-wider text-gray-400">AI Consensus Recommendation</div><div className={`mt-0.5 text-xl font-black ${consensus.direction === 'RISE' ? 'text-emerald-300' : consensus.direction === 'FALL' ? 'text-rose-300' : 'text-amber-300'}`}>{consensus.direction === 'WAIT' ? 'WAIT' : `${consensus.direction} ${consensus.direction === 'RISE' ? '↑' : '↓'}`}</div></div><div className="text-right"><div className="text-lg font-black text-cyan-300">{consensus.confidence}%</div><div className="text-[9px] text-gray-400">confidence</div></div></div>
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/5 bg-black/30 p-2 text-center"><div><div className="text-[9px] text-gray-500">AGREEMENT</div><div className="font-bold text-white">{consensus.agreement}%</div></div><div><div className="text-[9px] text-gray-500">DURATION</div><div className="font-bold text-white">{consensus.recommendedDuration.label}</div></div><div><div className="text-[9px] text-gray-500">EXPIRY</div><div className="font-mono font-bold text-cyan-300">{formatExpiry(consensus.expiresInSeconds)}</div></div></div>
            <div className="flex items-center justify-between text-[10px] font-semibold"><span className={consensus.status === 'EXPIRING' ? 'text-amber-300' : consensus.status === 'EXPIRED' ? 'text-rose-300' : 'text-emerald-300'}>{consensus.status}</span><span className="text-gray-400">{consensus.totalEngines} signal engines evaluated</span></div>
          </div>
        )}

        {modeRecommendations.length > 0 && <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="text-[10px] font-black uppercase tracking-wider text-gray-400">Mode Recommendations</div><div className="grid grid-cols-3 gap-2">{modeRecommendations.map((rec) => <button key={rec.mode} type="button" onClick={() => { const source = signals.find((s) => s.id === rec.sourceSignalId); if (source) onAutoFillTrade(source); }} className="rounded-xl border border-white/10 bg-black/30 p-2 text-left"><div className="text-[9px] font-bold text-gray-500">{modeLabel[rec.mode]}</div><div className={`text-sm font-black ${rec.direction === 'RISE' ? 'text-emerald-300' : 'text-rose-300'}`}>{rec.direction}</div><div className="text-[10px] font-bold text-cyan-300">{rec.confidence}% · {rec.duration.label}</div></button>)}</div></div>}

        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-2.5 text-xs"><span>Asset: <strong className="text-white">{activeSymbol?.underlying_symbol_name || 'Volatility 100 (1s) Index'}</strong></span><span className="flex items-center gap-1 font-semibold text-cyan-400"><Activity className="h-3.5 w-3.5" /> Tick Engine Active</span></div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-1"><button type="button" onClick={() => setActiveTab('signals')} className={`rounded-xl py-2 text-xs font-bold ${activeTab === 'signals' ? 'border border-cyan-500/40 bg-cyan-500/20 text-cyan-300' : 'text-slate-400'}`}><Radio className="mr-1 inline h-3.5 w-3.5" /> AI Trade Signals</button><button type="button" onClick={() => setActiveTab('multimodel')} className={`rounded-xl py-2 text-xs font-bold ${activeTab === 'multimodel' ? 'border border-purple-500/40 bg-purple-500/20 text-purple-300' : 'text-slate-400'}`}><Cpu className="mr-1 inline h-3.5 w-3.5" /> Multi-Model Layer</button></div>

        {activeTab === 'multimodel' ? <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-xs text-slate-400">8 Model Engines &amp; Regime Matrix</span><button type="button" onClick={() => void fetchEnsembleData()} disabled={isEvaluating} className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${isEvaluating ? 'animate-spin' : ''}`} /> Refresh Matrix</button></div>{ensembleError ? <div className="space-y-2 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-xs text-rose-200"><div className="font-bold">Multi-Model evaluation unavailable</div><div className="break-words text-rose-300/80">{ensembleError}</div><button type="button" onClick={() => void fetchEnsembleData()} disabled={isEvaluating} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-bold">Retry</button></div> : <MultiModelEvaluationCard ensemble={ensembleData} />}</div> : <>
          <div className="flex gap-1.5 overflow-x-auto pb-1"><span className="mr-1 flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase text-gray-400"><Layers className="h-3 w-3 text-cyan-400" /> Duration:</span>{durationOptions.map((option) => <button key={option.id} type="button" onClick={() => setSelectedDurationFilter(option.id)} className={`whitespace-nowrap rounded-xl border px-2.5 py-1 text-xs font-semibold ${selectedDurationFilter === option.id ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300' : 'border-white/5 bg-white/5 text-gray-400'}`}>{option.label}</button>)}</div>
          <div className="space-y-3">{visibleSignals.length === 0 ? <div className="rounded-2xl border border-white/5 bg-white/5 p-8 text-center"><Radio className="mx-auto h-8 w-8 animate-spin text-gray-500" /><p className="mt-2 text-sm font-medium text-gray-300">Scanning Live Tick Stream...</p></div> : visibleSignals.map((signal) => { const isRise = signal.direction === 'RISE'; const isExecuting = executingId === signal.id; const isHighConfidence = signal.confidence >= 88; return <div key={signal.id} className={`space-y-3 rounded-2xl border p-3.5 ${isHighConfidence ? 'border-cyan-500/40 bg-[#10192b]' : 'border-white/10 bg-[#101625]'}`}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5">{signal.category === 'AI' && <span className="flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/20 px-2 py-0.5 text-[10px] font-black text-purple-300"><Sparkles className="h-3 w-3" /> AI Neural</span>}{signal.category === 'VOLATILITY' && <span className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-300"><Zap className="h-3 w-3" /> Volatility</span>}<span className="text-xs font-bold text-white">{signal.name}</span></div><p className="line-clamp-1 text-[11px] text-gray-400">{signal.description}</p></div><div className="text-right"><div className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-black ${isRise ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' : 'border-rose-500/40 bg-rose-500/20 text-rose-300'}`}>{isRise ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} {signal.direction}</div><span className="text-[10px] font-mono font-bold text-cyan-300">{signal.confidence}% Model</span></div></div>
            {signal.durationMatrix?.length ? <div className="space-y-1"><div className="flex justify-between text-[10px] font-extrabold uppercase text-gray-400"><span>Predicted Horizon Matrix</span><span className="font-normal text-cyan-400">Tap duration to select</span></div><div className="grid grid-cols-4 gap-1.5">{signal.durationMatrix.map((duration) => { const recommended = signal.recommendedDurationValue === duration.value && signal.recommendedDurationUnit === duration.unit; return <button key={`${duration.value}${duration.unit}`} type="button" onClick={() => handleSelectDurationPrediction(signal, duration)} className={`rounded-xl border p-1.5 text-center ${recommended ? 'border-cyan-400 bg-cyan-500/20 text-white' : 'border-white/5 bg-black/30 text-gray-300'}`}><div className="text-[10px] font-bold">{duration.label}</div><div className={`flex items-center justify-center gap-0.5 text-[10px] font-black ${duration.direction === 'RISE' ? 'text-emerald-400' : 'text-rose-400'}`}>{duration.direction === 'RISE' ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />} {duration.confidence}%</div></button>; })}</div></div> : null}
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/5 bg-black/40 p-2 text-[11px]"><div className="flex gap-1"><Clock className="h-3.5 w-3.5 shrink-0 text-cyan-400" /><div><div className="text-[9px] text-gray-400">REC. DURATION</div><div className="font-bold text-white">{signal.recommendedDurationLabel}</div></div></div><div className="flex gap-1"><Target className="h-3.5 w-3.5 shrink-0 text-emerald-400" /><div><div className="text-[9px] text-gray-400">TARGET</div><div className="font-mono font-bold text-white">{signal.targetBarrier || 'Market'}</div></div></div><div className="text-right"><div className="text-[9px] text-gray-400">EXPIRY</div><div className={`font-mono font-bold ${signal.expiresInSeconds <= 10 ? 'text-amber-300' : 'text-cyan-400'}`}>{formatExpiry(signal.expiresInSeconds)}</div></div></div>
            <div className="text-[10px] text-gray-500">Signal lifecycle: {signal.expiresInSeconds <= 0 ? 'EXPIRED — waiting for next verified signal' : signal.expiresInSeconds <= 10 ? 'EXPIRING — refresh imminent' : 'ACTIVE'} · Model probability is not historical win rate.</div>
            <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => onAutoFillTrade(signal)} className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-white"><Sliders className="h-3.5 w-3.5 text-cyan-400" /> Auto-Fill Form</button><button type="button" disabled={isBuying || isExecuting || signal.expiresInSeconds <= 0} onClick={() => void handleQuickExecute(signal)} className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50 ${isRise ? 'border-emerald-400/30 bg-emerald-600' : 'border-rose-400/30 bg-rose-600'}`}>{isExecuting ? <Radio className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {isExecuting ? 'Placing Trade...' : `Execute ${signal.direction}`}</button></div>
          </div>; })}</div>
        </>}
      </div>
    </div>
  );
}