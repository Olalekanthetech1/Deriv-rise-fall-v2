'use client';

import { Users, X, Award, TrendingUp, CheckCircle2 } from 'lucide-react';

interface SocialDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SocialDrawer({ isOpen, onClose }: SocialDrawerProps) {
  if (!isOpen) return null;

  const mockTraders = [
    { name: 'XGBoost Alpha Bot', winRate: '94.2%', profit: '+$14,250', followers: '3.4k', badge: 'Top AI Trader' },
    { name: 'DerivPro Trader', winRate: '88.7%', profit: '+$8,910', followers: '1.8k', badge: 'Verified Pro' },
    { name: 'QuantRise Master', winRate: '86.1%', profit: '+$6,400', followers: '940', badge: 'Top Scalper' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0f1420] border border-white/10 p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Social Trading Leaderboard</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          {mockTraders.map((trader, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-2xl bg-card border border-border flex items-center justify-between shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                  #{idx + 1}
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1">
                    {trader.name}
                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400/20" />
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span className="text-emerald-400 font-semibold">{trader.winRate} Win Rate</span>
                    <span>·</span>
                    <span>{trader.followers} copiers</span>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-extrabold text-emerald-400">{trader.profit}</div>
                <button
                  type="button"
                  className="mt-1 px-2.5 py-0.5 rounded-full bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary text-[10px] font-bold"
                >
                  Copy Trade
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
