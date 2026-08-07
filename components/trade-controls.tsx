'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EndTimePicker } from '@/components/custom/end-time-picker';
import type { DerivWS, ActiveSymbol, ProposalInfo, BuyResult } from '@deriv/core';
import type { Direction, DurationSelectUnit, DurationOption } from '../lib/types';
import { calculateDynamicOptimalDuration, type AutoHorizonMode } from '../lib/duration-utils';
import { formatDurationLabel } from '@/lib/duration-formatter';

interface TradeControlsProps {
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  allowEquals: boolean;
  onAllowEqualsChange: (value: boolean) => void;
  isConnected: boolean;
  stake: string;
  onStakeChange: (value: string) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  durationOptions: DurationOption[];
  durationUnit: DurationSelectUnit;
  onDurationUnitChange: (unit: DurationSelectUnit) => void;
  endDate: Date | undefined;
  onEndDateChange: (date: Date | undefined) => void;
  endTime: string;
  onEndTimeChange: (time: string) => void;
  ws: DerivWS | null;
  activeSymbol: ActiveSymbol | null;
  proposal: ProposalInfo | null;
  prices?: number[];

  onBuy: () => void;
  isBuying: boolean;
  buyResult: BuyResult | null;
  buyError: string | null;
  onClearBuyResult: () => void;
  /** Whether the user is authenticated — shows the View your positions link when true. */
  isAuthenticated?: boolean;
  onLogin?: () => void;
  onOpenPositions?: () => void;
}

export function TradeControls({
  direction,
  onDirectionChange,
  allowEquals,
  onAllowEqualsChange,
  isConnected,
  stake,
  onStakeChange,
  duration,
  onDurationChange,
  durationOptions,
  durationUnit,
  onDurationUnitChange,
  endDate,
  onEndDateChange,
  endTime,
  onEndTimeChange,
  ws,
  activeSymbol,
  proposal,
  prices,
  onBuy,
  isBuying,
  buyResult,
  buyError,
  onClearBuyResult,
  isAuthenticated,
  onLogin,
  onOpenPositions,
}: TradeControlsProps) {
  useEffect(() => {
    if (buyError) {
      toast.error('Purchase Failed', { description: buyError });
      onClearBuyResult();
    }
  }, [buyError, onClearBuyResult]);

  useEffect(() => {
    if (buyResult) {
      const durationStr = formatDurationLabel(duration, durationUnit);
      toast.success(`Contract Purchased (${durationStr})`, {
        description: `Duration: ${durationStr} | Stake: ${buyResult.buyPrice.toFixed(2)} USD | Payout: ${buyResult.payout.toFixed(2)} USD | Balance: ${buyResult.balanceAfter.toFixed(2)} USD`,
      });
      onClearBuyResult();
    }
  }, [buyResult, onClearBuyResult, duration, durationUnit]);

  const [isAutoDuration, setIsAutoDuration] = useState(false);
  const [autoHorizonMode, setAutoHorizonMode] = useState<AutoHorizonMode>('auto');

  const dynamicOptimal = useMemo(() => {
    return calculateDynamicOptimalDuration(durationOptions, activeSymbol, autoHorizonMode, prices);
  }, [durationOptions, activeSymbol, autoHorizonMode, prices]);

  useEffect(() => {
    if (isAutoDuration && dynamicOptimal) {
      if (duration !== dynamicOptimal.duration) {
        onDurationChange(dynamicOptimal.duration);
      }
      if (durationUnit !== dynamicOptimal.unit) {
        onDurationUnitChange(dynamicOptimal.unit);
      }
    }
  }, [isAutoDuration, dynamicOptimal, duration, durationUnit, onDurationChange, onDurationUnitChange]);

  const activeOption = durationOptions.find(o => o.unit === durationUnit);

  const endTimeOption = durationOptions.find(o => o.unit === 'end-time');
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

  return (
    <div className="w-full space-y-2 lg:max-w-[400px] lg:space-y-4">
      {/* Rise / Fall direction segmented control */}
      <ToggleGroup
        type="single"
        value={direction}
        onValueChange={(value) => {
          if (value === 'CALL' || value === 'PUT') onDirectionChange(value);
        }}
        className="w-full gap-0 rounded-full bg-muted p-1"
      >
        <ToggleGroupItem
          value="CALL"
          className="flex-1 rounded-full text-sm font-medium text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-green-600 data-[state=on]:font-bold data-[state=on]:shadow-sm hover:text-foreground"
        >
          Rise
        </ToggleGroupItem>
        <ToggleGroupItem
          value="PUT"
          className="flex-1 rounded-full text-sm font-medium text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-destructive data-[state=on]:font-bold data-[state=on]:shadow-sm hover:text-foreground"
        >
          Fall
        </ToggleGroupItem>
      </ToggleGroup>

      {/* Allow equals */}
      <div className="flex items-center justify-between">
        <Label htmlFor="allow-equals" className="text-sm cursor-pointer">Allow equals</Label>
        <Switch
          id="allow-equals"
          checked={allowEquals}
          onCheckedChange={onAllowEqualsChange}
        />
      </div>

      {/* Stake */}
      <div className="space-y-1.5">
        <Label htmlFor="stake" className="text-xs text-muted-foreground">Stake</Label>
        <Input
          id="stake"
          type="number"
          value={stake}
          onChange={(e) => onStakeChange(e.target.value)}
          onKeyDown={(e) => {
            if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
          }}
          min={0}
          step="0.01"
          labelRight="USD"
        />
      </div>

      {/* Duration Block */}
      <div className="space-y-1.5">
        {/* Header Row: Duration Label & Pill Toggle */}
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground font-semibold">Duration</Label>
          <div className="flex items-center p-0.5 bg-card/90 rounded-lg border border-border/80 text-xs">
            <button
              type="button"
              onClick={() => setIsAutoDuration(false)}
              className={`px-3 py-1 rounded-md font-medium transition-all text-[11px] ${
                !isAutoDuration
                  ? 'bg-muted text-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => setIsAutoDuration(true)}
              className={`px-3 py-1 rounded-md font-medium transition-all text-[11px] ${
                isAutoDuration
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Auto
            </button>
          </div>
        </div>

        {/* If Auto Duration Mode is active */}
        {isAutoDuration ? (
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
            <Select
              value={durationUnit}
              onValueChange={(v) => {
                const opt = durationOptions.find(o => o.unit === v);
                if (opt) onDurationUnitChange(opt.unit);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {durationOptions.map(opt => (
                  <SelectItem key={opt.unit} value={opt.unit}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {durationUnit !== 'end-time' && (
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
                min={activeOption?.min}
                max={activeOption?.max}
                step={1}
              />
            )}

            {durationUnit === 'end-time' && (
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
            )}
          </>
        )}
      </div>

      {/* Buy button — inline on desktop, fixed above footer on mobile */}
      <div className="max-lg:fixed max-lg:bottom-[calc(env(safe-area-inset-bottom)+2.5rem)] max-lg:left-3 max-lg:right-3 lg:static">
        <Button
          className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground"
          size="lg"
          disabled={isAuthenticated && (!isConnected || !proposal || isBuying)}
          onClick={() => {
            if (!isAuthenticated) {
              toast.error('Authentication Required', {
                description: 'Please log in to your Deriv account to execute trades.',
              });
              return;
            }
            if (isAutoDuration) {
              const optimal = calculateDynamicOptimalDuration(durationOptions, activeSymbol);
              onDurationChange(optimal.duration);
              onDurationUnitChange(optimal.unit);
            }
            import('@/lib/trade-store').then(m => m.tradeStrategyStore.setStrategy('Manual'));
            onBuy();
          }}
        >
          {isBuying ? (
            'Purchasing...'
          ) : !isAuthenticated ? (
            'Log In to Trade'
          ) : (
            <span className="flex flex-col items-center leading-tight gap-0.5">
              <span>Buy</span>
              {proposal && (
                <span className="text-xs font-normal opacity-90">
                  Payout {proposal.payout.toFixed(2)} USD
                </span>
              )}
            </span>
          )}
        </Button>
      </div>

      {/* View your positions — shown when authenticated */}
      {isAuthenticated && (
        <Button
          type="button"
          variant="ghost"
          onClick={onOpenPositions}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          View your positions →
        </Button>
      )}
    </div>
  );
}
