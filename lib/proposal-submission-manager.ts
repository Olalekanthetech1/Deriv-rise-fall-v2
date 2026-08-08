'use client';

import type { DerivWS, ProposalInfo, ProposalParams } from '@deriv/core';

/**
 * Central proposal request coordinator for a single Deriv WebSocket.
 *
 * Proposal subscriptions are deliberately NOT used here. The trading flow
 * only needs a valid proposal immediately before buying, and Deriv rejects
 * duplicate subscriptions with AlreadySubscribed. A one-shot proposal request
 * avoids that server-side subscription state entirely while this manager still
 * deduplicates concurrent identical requests.
 */
export class ProposalSubmissionManager {
  private readonly ws: DerivWS;
  private pending = new Map<string, Promise<ProposalInfo | null>>();

  constructor(ws: DerivWS) {
    this.ws = ws;
  }

  private key(params: ProposalParams): string {
    return JSON.stringify({
      contractType: params.contractType,
      symbol: params.symbol,
      amount: params.amount,
      basis: params.basis,
      currency: params.currency,
      duration: params.duration,
      durationUnit: params.durationUnit,
      dateExpiry: params.dateExpiry,
    });
  }

  async getProposal(params: ProposalParams): Promise<ProposalInfo | null> {
    const key = this.key(params);
    const existing = this.pending.get(key);
    if (existing) return existing;

    const request = (async () => {
      try {
        const response = await this.ws.send<{
          proposal?: ProposalInfo;
          error?: { code?: string; message?: string };
        }>({
          proposal: 1,
          amount: params.amount,
          basis: params.basis,
          contract_type: params.contractType,
          currency: params.currency,
          underlying_symbol: params.symbol,
          duration: params.duration,
          duration_unit: params.durationUnit,
          ...(params.dateExpiry ? { date_expiry: params.dateExpiry } : {}),
        });

        return response.proposal ?? null;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, request);
    return request;
  }

  clear(): void {
    this.pending.clear();
  }
}
