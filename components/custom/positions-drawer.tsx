'use client';

import { X, Layers } from 'lucide-react';
import { PositionsTable, PositionFilter } from './positions-table';
import type { OpenPosition } from '@/hooks/use-open-positions';
import type { ClosedPosition } from '@/hooks/use-closed-positions';

interface PositionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
  onSell: (contractId: number, bidPrice: string) => Promise<void>;
  sellingId: number | null;
  sellError: string | null;
  onClearSellError: () => void;
  contractTypeLabels?: Record<string, string>;
}

export function PositionsDrawer({
  isOpen,
  onClose,
  openPositions,
  closedPositions,
  onSell,
  sellingId,
  sellError,
  onClearSellError,
  contractTypeLabels,
}: PositionsDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Sheet Content */}
      <div className="relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#0a0f1d] border border-white/10 p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
        {/* Header matching image design */}
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Trading Positions &amp; Reports
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Embedded Positions Table */}
        <PositionsTable
          openPositions={openPositions}
          closedPositions={closedPositions}
          onSell={onSell}
          sellingId={sellingId}
          sellError={sellError}
          onClearSellError={onClearSellError}
          contractTypeLabels={contractTypeLabels}
          className="mt-2"
        />
      </div>
    </div>
  );
}
