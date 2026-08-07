'use client';

import type { ProposalInfo } from '@deriv/core';

interface PayoutInfoCardProps {
  proposal: ProposalInfo | null;
  stake: string;
}

export function PayoutInfoCard({ proposal, stake }: PayoutInfoCardProps) {
  const numericStake = parseFloat(stake) || 10;
  
  let payout = numericStake * 1.95; // Default ~95% return estimate if proposal loading
  let profit = numericStake * 0.95;
  let returnPercent = 95;

  if (proposal) {
    payout = proposal.payout;
    profit = proposal.payout - proposal.askPrice;
    returnPercent = proposal.askPrice > 0 ? (profit / proposal.askPrice) * 100 : 95;
  }

  return (
    <div className="w-full rounded-2xl bg-[#0e131d]/90 border border-white/10 p-3.5 shadow-lg backdrop-blur-md flex items-center justify-between my-2">
      <div className="flex flex-col">
        <span className="text-[11px] font-medium text-gray-400 tracking-wide uppercase">Payout</span>
        <span className="text-lg font-bold text-white leading-tight">
          ${payout.toFixed(2)}
        </span>
      </div>

      <div className="px-3.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 text-xs font-bold tracking-wider shadow-inner">
        +{returnPercent.toFixed(0)}%
      </div>

      <div className="flex flex-col items-end">
        <span className="text-[11px] font-medium text-gray-400 tracking-wide uppercase">Profit</span>
        <span className="text-lg font-bold text-emerald-400 leading-tight">
          +${profit.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
