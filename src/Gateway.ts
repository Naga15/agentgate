/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { AdapterRegistry } from './adapters';
import { AuditLog } from './AuditLog';
import { BudgetTracker } from './BudgetTracker';
import { PolicyEngine } from './PolicyEngine';
import { ProposalStore } from './ProposalStore';
import { ToolRegistry } from './ToolRegistry';
import {
  Adapter,
  InvocationRequest,
  InvocationResult,
  ToolDescriptor,
} from './types';

/**
 * @public
 */
export interface GatewayOptions {
  registry: ToolRegistry;
  policy: PolicyEngine;
  audit: AuditLog;
  proposals: ProposalStore;
  budget: BudgetTracker;
  /** Map of target-type → adapter (e.g. `{ local: new LocalAdapter() }`). */
  adapters: Partial<Record<ToolDescriptor['target']['type'], Adapter>>;
}

/**
 * The control plane. Every governed tool call passes through `invoke`, which
 * applies, in order:
 *
 *   1. registry  — the tool must be known (and carries its `kind`)
 *   2. approved-proposal short-circuit — an approved proposal executes directly
 *   3. policy     — allow / deny / require_approval for (principal, tool)
 *   4. budget     — per-session caps
 *   5. execute or propose
 *
 * Every path records exactly one audit event.
 *
 * @public
 */
export class Gateway {
  readonly registry: ToolRegistry;
  readonly policy: PolicyEngine;
  readonly audit: AuditLog;
  readonly proposals: ProposalStore;
  readonly budget: BudgetTracker;
  private readonly adapters: AdapterRegistry;

  constructor(opts: GatewayOptions) {
    this.registry = opts.registry;
    this.policy = opts.policy;
    this.audit = opts.audit;
    this.proposals = opts.proposals;
    this.budget = opts.budget;
    this.adapters = new AdapterRegistry(opts.adapters);
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    const tool = this.registry.get(req.tool);

    // 1. Unknown tool — deny.
    if (!tool) {
      return this.finish(req, 'unknown', 'unknown', 'denied', {
        reason: `unknown tool: '${req.tool}'`,
      });
    }

    // 2. Approved-proposal short-circuit.
    if (req.approvedProposalId) {
      const verdict = this.verifyApprovedProposal(req, tool);
      if (verdict.ok) {
        return this.execute(req, tool, 'allow');
      }
      return this.finish(req, tool.kind, 'require_approval', 'denied', {
        reason: verdict.reason,
      });
    }

    // 3. Policy.
    const decision = this.policy.decide(req.principal, tool);
    if (decision === 'deny') {
      return this.finish(req, tool.kind, 'deny', 'denied', {
        reason: `policy denied tool '${tool.name}' for principal '${req.principal.id}'`,
      });
    }

    // `propose` tools never execute directly, regardless of an allow rule —
    // proposing is their entire purpose.
    if (decision === 'require_approval' || tool.kind === 'propose') {
      const proposal = this.proposals.create({
        principal: req.principal,
        sessionId: req.sessionId,
        tool: tool.name,
        input: req.input,
        kind: tool.kind,
      });
      const auditId = this.audit.record({
        ts: Date.now(),
        principalId: req.principal.id,
        sessionId: req.sessionId,
        tool: tool.name,
        kind: tool.kind,
        decision: 'require_approval',
        outcome: 'proposed',
      });
      return { status: 'proposed', proposal, auditId };
    }

    // 4 + 5. allow → budget check → execute.
    return this.execute(req, tool, 'allow');
  }

  private async execute(
    req: InvocationRequest,
    tool: ToolDescriptor,
    decision: 'allow',
  ): Promise<InvocationResult> {
    const breach = this.budget.check(req.sessionId, tool.kind);
    if (breach) {
      return this.finish(req, tool.kind, decision, 'denied', {
        reason: `budget exceeded: ${breach}`,
      });
    }

    let adapter: Adapter;
    try {
      adapter = this.adapters.resolve(tool);
    } catch (e) {
      return this.finish(req, tool.kind, decision, 'error', {
        reason: (e as Error).message,
      });
    }

    try {
      const output = await adapter.execute(tool, req.input);
      this.budget.record(req.sessionId, tool.kind);
      const auditId = this.audit.record({
        ts: Date.now(),
        principalId: req.principal.id,
        sessionId: req.sessionId,
        tool: tool.name,
        kind: tool.kind,
        decision,
        outcome: 'executed',
      });
      return { status: 'executed', output, auditId };
    } catch (e) {
      return this.finish(req, tool.kind, decision, 'error', {
        reason: `tool '${tool.name}' threw: ${(e as Error).message}`,
      });
    }
  }

  private verifyApprovedProposal(
    req: InvocationRequest,
    tool: ToolDescriptor,
  ): { ok: true } | { ok: false; reason: string } {
    const proposal = this.proposals.get(req.approvedProposalId!);
    if (!proposal) {
      return { ok: false, reason: `unknown proposal: '${req.approvedProposalId}'` };
    }
    if (proposal.status !== 'approved') {
      return {
        ok: false,
        reason: `proposal '${proposal.id}' is '${proposal.status}', not 'approved'`,
      };
    }
    // The execution must match what was approved — same principal, tool, and
    // input. This stops an approved cheap proposal from being swapped for an
    // expensive or different call.
    if (
      proposal.tool !== tool.name ||
      proposal.principal.id !== req.principal.id ||
      JSON.stringify(proposal.input) !== JSON.stringify(req.input)
    ) {
      return {
        ok: false,
        reason: `request does not match approved proposal '${proposal.id}'`,
      };
    }
    return { ok: true };
  }

  private finish(
    req: InvocationRequest,
    kind: ToolDescriptor['kind'] | 'unknown',
    decision: 'allow' | 'deny' | 'require_approval' | 'unknown',
    outcome: InvocationResult['status'],
    extra: { reason?: string },
  ): InvocationResult {
    const auditId = this.audit.record({
      ts: Date.now(),
      principalId: req.principal.id,
      sessionId: req.sessionId,
      tool: req.tool,
      kind,
      decision,
      outcome,
      reason: extra.reason,
    });
    return { status: outcome, reason: extra.reason, auditId };
  }
}
