'use client';

import { useMemo, useState, useEffect } from 'react';
import { Sparkles, Layers } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { EndTimePicker } from '@/components/custom/end-time-picker';
import type { DerivWS, ActiveSymbol } from '@deriv/core';
import type { DurationSelectUnit, DurationOption } from '@/lib/types';
import { calculateDynamicOptimalDuration, type AutoHorizonMode } from '@/lib/duration-utils';

export interface DerivTradeConfigFieldsProps {
  allowEquals?: boolean;
  onAllowEqualsChange?: (val: boolean) => void;
  stake: string;
  onStakeChange: (val: string) => void;
  duration: number;
  onDurationChange: (val: number) => void;
  durationUnit: DurationSelectUnit;
  onDurationUnitChange: (unit: DurationSelectUnit) => void;
  durationOptions: DurationOption[];
  isAutoDuration?: boolean;
  onAutoDurationChange?: (isAuto: boolean) => void;
  multiContractMultiplier?: number;
  onMultiContractMultiplierChange?: (multiplier: number) => void;
  endDate?: Date;
  onEndDateChange?: (date: Date | undefined) => void;
  endTime?: string;
  onEndTimeChange?: (time: string) => void;
  ws?: DerivWS | null;
  isConnected?: boolean;
  activeSymbol?: ActiveSymbol | null;
  prices?: number[];
  showAllowEquals?: boolean;
  showMultiContract?: boolean;
}

export function DerivTradeConfigFields({
  allowEquals = false,
  onAllowEqualsChange,
  stake,
  onStakeChange,
  duration,
  onDurationChange,
  durationUnit,
  onDurationUnitChange,
  durationOptions,
  isAutoDuration: propIsAutoDuration,
  onAutoDurationChange,
  multiContractMultiplier = 1,
  onMultiContractMultiplierChange,
  endDate,
  onEndDateChange,
  endTime = '23:59',
  onEndTimeChange,
  ws = null,
  isConnected = false,
  activeSymbol = null,
  prices,
  showAllowEquals = true,
  showMultiContract = true,
}: DerivTradeConfigFieldsProps) {
  const [internalAutoDuration, setInternalAutoDuration] = useState(false);
  const [autoHorizonMode, setAutoHorizonMode] = useState<AutoHorizonMode>('auto');
  const isAuto = propIsAutoDuration !== undefined ? propIsAutoDuration : internalAutoDuration;

  const dynamicOptimal = useMemo(() => {
    return calculateDynamicOptimalDuration(durationOptions, activeSymbol, autoHorizonMode, prices);
  }, [durationOptions, activeSymbol, autoHorizonMode, prices]);

  // Keep parent duration and durationUnit synchronized whenever isAuto is active
  useEffect(() => {
    if (isAuto && dynamicOptimal) {
      if (duration !== dynamicOptimal.duration) {
        onDurationChange(dynamicOptimal.duration);
      }
      if (durationUnit !== dynamicOptimal.unit) {
        onDurationUnitChange(dynamicOptimal.unit);
      }
    }
  }, [isAuto, dynamicOptimal, duration, durationUnit, onDurationChange, onDurationUnitChange]);

  const handleToggleAuto = (val: boolean) => {
    if (val && dynamicOptimal) {
      onDurationChange(dynamicOptimal.duration);
      onDurationUnitChange(dynamicOptimal.unit);
    }
    if (onAutoDurationChange) {
      onAutoDurationChange(val);
    } else {
      setInternalAutoDuration(val);
    }
  };

  const activeOption = durationOptions.find((o) => o.unit === durationUnit);

  const endTimeOption = durationOptions.find((o) => o.unit === 'end-time');
  const { endTimeMinDate, endTimeMaxDate } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      endTimeMinDate: today,
      endTimeMaxDate: endTimeOption
        ? new Date(today.getTime() + endTimeOption.max * 86400000)
        : new Date(today.getTime() + 365 * 86400000),
    };
  }, [endTimeOption]);

  const quickStakes = ['5', '10', '25', '50'];
  const multiplierOptions = [1, 2, 3, 5];

  return (
    <div className="w-full space-y-3.5">
      {/* Allow Equals Row */}
      {showAllowEquals && onAllowEqualsChange && (
        <div className="flex items-center justify-between py-1">
          <Label htmlFor="allow-equals-field" className="text-sm font-semibold cursor-pointer text-foreground">
            Allow equals
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {allowEquals ? 'On' : 'Off'}
            </span>
            <Switch
              id="allow-equals-field"
              checked={allowEquals}
              onCheckedChange={onAllowEqualsChange}
            />
          </div>
        </div>
      )}

      {/* Multi-Contract Execution Multiplier Row (Optional/Pro feature) */}
      {showMultiContract && onMultiContractMultiplierChange && (
        <div className="space-y-1.5 p-2 bg-card/60 rounded-xl border border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <Label className="text-xs font-bold text-foreground">Multi-Contract Batch Execution</Label>
            </div>
            <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
              {multiContractMultiplier}x Contracts
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {multiplierOptions.map((mult) => {
              const isSelected = multiContractMultiplier === mult;
              return (
                <button
                  key={mult}
                  type="button"
                  onClick={() => onMultiContractMultiplierChange(mult)}
                  className={`py-1 text-xs font-bold rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-cyan-500 text-white border-cyan-400 shadow-sm'
                      : 'bg-card text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {mult}x
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Stake Block */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-muted-foreground">Stake</Label>
        
        {/* Quick Stake Preset Buttons */}
        <div className="grid grid-cols-4 gap-2">
          {quickStakes.map((amt) => {
            const isSelected = stake === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => onStakeChange(amt)}
                className={`h-10 rounded-xl text-xs font-bold transition-all border ${
                  isSelected
                    ? 'bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-950/40'
                    : 'bg-card/70 text-foreground border-border/80 hover:bg-muted hover:border-border'
                }`}
              >
                {amt}
              </button>
            );
          })}
        </div>

        {/* Stake Numeric Input Field */}
        <div className="relative flex items-center">
          <Input
            type="number"
            value={stake}
            onChange={(e) => onStakeChange(e.target.value)}
            onKeyDown={(e) => {
              if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
            }}
            min={0}
            step="0.01"
            className="h-11 rounded-xl bg-card border-border pr-12 text-sm font-bold text-foreground"
          />
          <span className="absolute right-3 text-xs font-bold text-muted-foreground pointer-events-none uppercase">
            USD
          </span>
        </div>
      </div>

      {/* Duration Block with Deriv Architecture (Manual vs Auto Toggle) */}
      <div className="space-y-2">
        {/* Header Row: Duration Label & Pill Toggle */}
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-muted-foreground">Duration</Label>
          <div className="flex items-center p-0.5 bg-card/90 rounded-lg border border-border/80 text-xs">
            <button
              type="button"
              onClick={() => handleToggleAuto(false)}
              className={`px-3 py-1 rounded-md font-medium transition-all text-[11px] ${
                !isAuto
                  ? 'bg-muted text-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => handleToggleAuto(true)}
              className={`px-3 py-1 rounded-md font-medium transition-all text-[11px] ${
                isAuto
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Auto
            </button>
          </div>
        </div>
        
        {/* If Auto Duration Mode is active */}
        {isAuto ? (
          <div className="relative overflow-hidden rounded-xl border border-indigo-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/80 p-3.5 shadow-md">
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-indigo-400 font-bold text-xs tracking-wide">
                  <Sparkles className="w-4 h-4 text-indigo-300 animate-pulse" />
                  <span>AI Auto Optimizer</span>
                </div>
                <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[11px] border border-emerald-500/20">
                  ⚡ {dynamicOptimal.label}
                </span>
              </div>

              {/* Multi-Horizon Target Selector */}
              {dynamicOptimal.availableUnits && dynamicOptimal.availableUnits.length > 1 && (
                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10 text-[10px]">
                  <span className="text-slate-400 text-[9px] px-1 font-semibold uppercase shrink-0">Horizon:</span>
                  <button
                    type="button"
                    onClick={() => setAutoHorizonMode('auto')}
                    className={`flex-1 py-0.5 px-1.5 rounded font-medium transition-all text-center ${
                      autoHorizonMode === 'auto'
                        ? 'bg-indigo-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    Auto
                  </button>
                  {dynamicOptimal.availableUnits.includes('t') && (
                    <button
                      type="button"
                      onClick={() => setAutoHorizonMode('t')}
                      className={`flex-1 py-0.5 px-1.5 rounded font-medium transition-all text-center ${
                        autoHorizonMode === 't'
                          ? 'bg-indigo-600 text-white font-bold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      Ticks
                    </button>
                  )}
                  {dynamicOptimal.availableUnits.includes('s') && (
                    <button
                      type="button"
                      onClick={() => setAutoHorizonMode('s')}
                      className={`flex-1 py-0.5 px-1.5 rounded font-medium transition-all text-center ${
                        autoHorizonMode === 's'
                          ? 'bg-indigo-600 text-white font-bold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      Seconds
                    </button>
                  )}
                  {dynamicOptimal.availableUnits.includes('m') && (
                    <button
                      type="button"
                      onClick={() => setAutoHorizonMode('m')}
                      className={`flex-1 py-0.5 px-1.5 rounded font-medium transition-all text-center ${
                        autoHorizonMode === 'm'
                          ? 'bg-indigo-600 text-white font-bold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      Minutes
                    </button>
                  )}
                </div>
              )}

              <p className="text-[10px] text-slate-400 font-normal leading-tight italic">
                {dynamicOptimal.explanation}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Manual Duration Unit Selector Pills */}
            <div className="flex items-center gap-1 overflow-x-auto p-1 bg-card/80 rounded-xl border border-border/80 no-scrollbar">
              {durationOptions.map((opt) => {
                const isSelected = durationUnit === opt.unit;
                return (
                  <button
                    key={opt.unit}
                    type="button"
                    onClick={() => onDurationUnitChange(opt.unit)}
                    className={`flex-1 min-w-[60px] py-1.5 px-2 text-[11px] font-semibold rounded-lg whitespace-nowrap transition-all text-center ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Duration Input or EndTimePicker */}
            {durationUnit !== 'end-time' ? (
              <Input
                type="number"
                value={duration === 0 || isNaN(duration) ? '' : duration}
                onChange={(e) => {
                  if (e.target.value === '') {
                    onDurationChange(0);
                  } else {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) onDurationChange(val);
                  }
                }}
                min={activeOption?.min || 1}
                max={activeOption?.max || 10}
                step={1}
                className="h-11 rounded-xl bg-card border-border text-sm font-bold text-foreground"
              />
            ) : (
              onEndDateChange && onEndTimeChange && (
                <EndTimePicker
                  ws={ws}
                  isConnected={isConnected}
                  activeSymbol={activeSymbol}
                  endDate={endDate}
                  onEndDateChange={onEndDateChange}
                  endTime={endTime}
                  onEndTimeChange={onEndTimeChange}
                  minDate={endTimeMinDate}
                  maxDate={endTimeMaxDate}
                />
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

