/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Proposal } from './types';

/**
 * Stores proposals awaiting human approval and their lifecycle.
 *
 * @public
 */
export interface ProposalStore {
  create(p: Omit<Proposal, 'id' | 'createdAt' | 'status'>): Proposal;
  get(id: string): Proposal | undefined;
  approve(id: string): Proposal | undefined;
  reject(id: string): Proposal | undefined;
  listPending(): Proposal[];
}

/**
 * In-memory reference `ProposalStore`.
 *
 * @public
 */
export class InMemoryProposalStore implements ProposalStore {
  private readonly map = new Map<string, Proposal>();
  private seq = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  create(p: Omit<Proposal, 'id' | 'createdAt' | 'status'>): Proposal {
    const proposal: Proposal = {
      ...p,
      id: `prop-${++this.seq}`,
      createdAt: this.now(),
      status: 'pending',
    };
    this.map.set(proposal.id, proposal);
    return proposal;
  }

  get(id: string): Proposal | undefined {
    return this.map.get(id);
  }

  approve(id: string): Proposal | undefined {
    return this.transition(id, 'approved');
  }

  reject(id: string): Proposal | undefined {
    return this.transition(id, 'rejected');
  }

  listPending(): Proposal[] {
    return [...this.map.values()].filter(p => p.status === 'pending');
  }

  private transition(
    id: string,
    status: Proposal['status'],
  ): Proposal | undefined {
    const p = this.map.get(id);
    if (!p) return undefined;
    if (p.status !== 'pending') return p; // only pending proposals transition
    const next = { ...p, status };
    this.map.set(id, next);
    return next;
  }
}
