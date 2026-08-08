'use client';

import type { DerivWS, ProposalInfo, ProposalParams } from '@deriv/core';

/**
 * Centralizes proposal subscriptions/requests for a single Deriv WebSocket.
 *
 * The Deriv API rejects duplicate proposal subscriptions with
 * AlreadySubscribed. This manager makes proposal creation idempotent by
 * keying an operation by its complete proposal parameters and reusing an
 * existing in-flight/active operation instead of creating another one.
 */
export class ProposalSubmissionManager {
  private readonly ws: DerivWS;
  private active = new Map<string, { subscriptionId?: string; proposal: ProposalInfo | null }>();
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
    const existing = this.active.get(key);
    if (existing?.proposal) return existing.proposal;

    const pending = this.pending.get(key);
    if (pending) return pending;

    const request = (async () => {
      try {
        const response = await this.ws.send<{
          proposal?: ProposalInfo & { subscription?: { id?: string } };
          error?: { code?: string; message?: string };
        }>({
          proposal: 1,
          subscribe: 1,
          amount: params.amount,
          basis: params.basis,
          contract_type: params.contractType,
          currency: params.currency,
          underlying_symbol: params.symbol,
          duration: params.duration,
          duration_unit: params.durationUnit,
          ...(params.dateExpiry ? { date_expiry: params.dateExpiry } : {}),
        });

        if (!response.proposal) return null;

        const proposal = response.proposal;
        this.active.set(key, {
          subscriptionId: proposal.subscription?.id,
          proposal,
        });
        return proposal;
      } catch (error: any) {
        // A duplicate subscription means another caller won the race. Return
        // the already-active proposal if one is now available; otherwise
        // propagate the real error.
        const code = error?.error?.code ?? error?.code;
        if (code === 'AlreadySubscribed') {
          const raced = this.active.get(key);
          if (raced?.proposal) return raced.proposal;
        }
        throw error;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, request);
    return request;
  }

  async forget(params: ProposalParams): Promise<void> {
    const key = this.key(params);
    const entry = this.active.get(key);
    this.active.delete(key);
    if (!entry?.subscriptionId) return;

    try {
      await this.ws.send({ forget: entry.subscriptionId });
    } catch {
      // Cleanup is best-effort. The local registry is already cleared so a
      // future request cannot be blocked by stale client-side state.
    }
  }

  clear(): void {
    this.active.clear();
    this.pending.clear();
  }
}
