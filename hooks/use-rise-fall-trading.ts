'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useBuy } from '@deriv/core';
import type {
  DerivWS,
  ActiveSymbol,
  Tick,
  ProposalInfo,
  ProposalParams,
  BuyResult,
} from '@deriv/core';
import type { ContractInfo } from '@deriv/core';
import { useBaseTrading } from '@/hooks/use-base-trading';
import type { UseBaseTradingParams } from '@/hooks/use-base-trading';
import type { Direction, DurationSelectUnit, DurationOption, OpenPosition, ClosedPosition } from '../lib/types';
import { getDurationOptions, computeEndTimeEpoch } from '@/lib/duration-utils';
import { ProposalSubmissionManager } from '@/lib/proposal-submission-manager';

const CONTRACT_TYPES = ['CALL', 'PUT'];

interface UseRiseFallTradingReturn {
  ws: DerivWS | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  symbols: ActiveSymbol[];
  activeSymbol: ActiveSymbol | null;
  selectSymbol: (symbol: string) => void;
  currentTick: Tick | null;
  prices: number[];
  pipSize: number;
  direction: Direction;
  setDirection: (direction: Direction) => void;
  allowEquals: boolean;
  setAllowEquals: (value: boolean) => void;
  stake: string;
  setStake: (value: string) => void;
  duration: number;
  setDuration: (value: number) => void;
  durationOptions: DurationOption[];
  durationUnit: DurationSelectUnit;
  setDurationUnit: (unit: DurationSelectUnit) => void;
  endDate: Date | undefined;
  setEndDate: (date: Date | undefined) => void;
  endTime: string;
  setEndTime: (time: string) => void;
  proposal: ProposalInfo | null;
  buyContract: (targetDir?: Direction) => Promise<void>;
  buyWithCustomParams: (params: {
    direction: Direction;
    duration: number;
    durationUnit: DurationSelectUnit;
  }) => Promise<void>;
  isBuying: boolean;
  buyResult: BuyResult | null;
  buyError: string | null;
  clearBuyResult: () => void;
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
  sellContract: (contractId: number, bidPrice: string) => Promise<void>;
  sellingId: number | null;
  sellError: string | null;
  clearSellError: () => void;
}

export type UseRiseFallTradingParams = Pick<UseBaseTradingParams, 'ws' | 'isConnected' | 'isExhausted' | 'isAuthenticated' | 'onAuthWSFailed'>;

export function useRiseFallTrading({ ws, isConnected, isExhausted, isAuthenticated, onAuthWSFailed }: UseRiseFallTradingParams): UseRiseFallTradingReturn {
  const {
    ws: tradingWs,
    isConnected: tradingIsConnected,
    isLoading,
    error,
    symbols,
    activeSymbol,
    selectSymbol,
    currentTick,
    prices,
    pipSize,
    contracts,
    openPositions,
    closedPositions,
    sellContract,
    sellingId,
    sellError,
    clearSellError,
  } = useBaseTrading({ ws, isConnected, isExhausted, isAuthenticated, onAuthWSFailed, contractTypes: CONTRACT_TYPES });

  const [direction, setDirection] = useState<Direction>('CALL');
  const [allowEquals, setAllowEquals] = useState(false);
  const [stake, setStake] = useState('10');
  const [duration, setDuration] = useState(1);
  const [durationUnit, setDurationUnitRaw] = useState<DurationSelectUnit>('t');
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState('');
  const [proposal, setProposal] = useState<ProposalInfo | null>(null);
  const [durationOptionsSymbol, setDurationOptionsSymbol] = useState<string | null>(null);

  const durationOptions = useMemo(() => getDurationOptions(contracts), [contracts]);
  const proposalManager = useMemo(
    () => (tradingWs ? new ProposalSubmissionManager(tradingWs) : null),
    [tradingWs]
  );

  const durationUnitRef = useRef(durationUnit);
  const activeSymbolKeyRef = useRef(activeSymbol?.underlying_symbol);

  useEffect(() => {
    durationUnitRef.current = durationUnit;
  }, [durationUnit]);

  useEffect(() => {
    activeSymbolKeyRef.current = activeSymbol?.underlying_symbol;
  }, [activeSymbol?.underlying_symbol]);

  /* eslint-disable react-hooks/set-state-in-effect -- reset duration/end-time state when contract limits change */
  useEffect(() => {
    if (!durationOptions.length) return;
    setEndDate(undefined);
    setEndTime('');
    setDurationOptionsSymbol(activeSymbolKeyRef.current ?? null);
    const currentOpt = durationOptions.find(o => o.unit === durationUnitRef.current);
    if (!currentOpt) {
      const first = durationOptions[0];
      setDurationUnitRaw(first.unit);
      if (first.unit !== 'end-time') setDuration(first.min);
    } else if (currentOpt.unit !== 'end-time') {
      setDuration(prev => (prev < currentOpt.min || prev > currentOpt.max) ? currentOpt.min : prev);
    }
  }, [durationOptions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setDurationUnit = useCallback((unit: DurationSelectUnit) => {
    setDurationUnitRaw(unit);
    const opt = durationOptions.find(o => o.unit === unit);
    if (opt && unit !== 'end-time') setDuration(opt.min);
  }, [durationOptions]);

  const buildProposalParams = useCallback((dir: Direction, customDuration = duration, customUnit = durationUnit): ProposalParams | null => {
    if (!activeSymbol || !durationOptions.length || durationOptionsSymbol !== activeSymbol.underlying_symbol) return null;
    const stakeNum = parseFloat(stake);
    if (!stakeNum || stakeNum <= 0) return null;

    const base = {
      contractType: allowEquals ? (dir === 'CALL' ? 'CALLE' : 'PUTE') : dir,
      symbol: activeSymbol.underlying_symbol,
      amount: stakeNum,
      basis: 'stake' as const,
      currency: 'USD',
    };

    if (customUnit === 'end-time') {
      const dateExpiry = computeEndTimeEpoch(endDate, endTime);
      if (!dateExpiry) return null;
      return { ...base, duration: 0, durationUnit: 'd', dateExpiry };
    }

    const opt = durationOptions.find(o => o.unit === customUnit);
    if (!opt || customDuration < opt.min || customDuration > opt.max) return null;

    if (customUnit === 'h') {
      return { ...base, duration: customDuration * 60, durationUnit: 'm' };
    }

    return { ...base, duration: customDuration, durationUnit: customUnit };
  }, [activeSymbol, durationOptions, durationOptionsSymbol, stake, allowEquals, duration, durationUnit, endDate, endTime]);

  // Exactly one managed proposal subscription is maintained for the currently
  // selected direction. CALL and PUT are no longer subscribed simultaneously.
  useEffect(() => {
    let cancelled = false;
    const manager = proposalManager;
    const params = buildProposalParams(direction);

    setProposal(null);
    if (!manager || !tradingIsConnected || !params) return;

    manager.getProposal(params)
      .then(result => {
        if (!cancelled) setProposal(result);
      })
      .catch(err => {
        if (!cancelled) console.error('[ProposalManager] proposal request failed:', err);
      });

    return () => {
      cancelled = true;
      void manager.forget(params);
    };
  }, [proposalManager, tradingIsConnected, direction, buildProposalParams]);

  // Ensure all managed subscriptions are cleaned up when the hook unmounts or
  // the authenticated WebSocket changes.
  useEffect(() => {
    return () => proposalManager?.clear();
  }, [proposalManager]);

  const { buyContract: buyWithProposal, isBuying, buyResult, buyError, clearBuyResult } =
    useBuy(tradingWs, tradingIsConnected);

  const buyContract = useCallback(async (targetDir?: Direction) => {
    const dir = targetDir || direction;
    if (dir === direction && proposal) {
      await buyWithProposal(proposal);
      return;
    }

    const params = buildProposalParams(dir);
    if (!params || !proposalManager) return;

    const targetProposal = await proposalManager.getProposal(params);
    if (targetProposal) await buyWithProposal(targetProposal);
  }, [direction, proposal, buildProposalParams, proposalManager, buyWithProposal]);

  const buyWithCustomParams = useCallback(async (params: {
    direction: Direction;
    duration: number;
    durationUnit: DurationSelectUnit;
  }) => {
    if (!tradingWs || !tradingIsConnected || !activeSymbol || !proposalManager) return;
    const stakeNum = parseFloat(stake);
    if (!stakeNum || stakeNum <= 0) return;

    const proposalParams = buildProposalParams(params.direction, params.duration, params.durationUnit);
    if (!proposalParams) return;

    try {
      // Every execution path now goes through the same idempotent manager.
      const targetProposal = await proposalManager.getProposal(proposalParams);
      if (!targetProposal) return;

      await buyWithProposal(targetProposal);

      // Update UI state only after the proposal was successfully submitted.
      setDirection(params.direction);
      setDurationUnit(params.durationUnit);
      setDuration(params.duration);
    } catch (err) {
      console.error('[ProposalManager] trade submission failed:', err);
      throw err;
    }
  }, [tradingWs, tradingIsConnected, activeSymbol, proposalManager, stake, buildProposalParams, buyWithProposal, setDurationUnit]);

  return {
    ws: tradingWs,
    isConnected: tradingIsConnected,
    isLoading,
    error,
    symbols,
    activeSymbol,
    selectSymbol,
    currentTick,
    prices,
    pipSize,
    direction,
    setDirection,
    allowEquals,
    setAllowEquals,
    stake,
    setStake,
    duration,
    setDuration,
    durationOptions,
    durationUnit,
    setDurationUnit,
    endDate,
    setEndDate,
    endTime,
    setEndTime,
    proposal,
    buyContract,
    buyWithCustomParams,
    isBuying,
    buyResult,
    buyError,
    clearBuyResult,
    openPositions,
    closedPositions,
    sellContract,
    sellingId,
    sellError,
    clearSellError,
  };
}
