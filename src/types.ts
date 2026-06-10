/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 */

/**
 * The class of side effect a tool can have. Fixed at registration so the
 * whole tool surface is auditable.
 *
 * - `read`    — observes state, no side effects
 * - `propose` — drafts a suggested action for a human; never executes
 * - `write`   — mutates the world; requires approval unless policy trusts the principal
 *
 * @public
 */
export type ToolKind = 'read' | 'propose' | 'write';

/**
 * Who is making a call. An agent, a human, or a service account.
 *
 * @public
 */
export interface Principal {
  id: string;
  type: 'agent' | 'user' | 'service';
  /** Arbitrary attributes for attribute-based policy (team, env, …). */
  attributes?: Record<string, string>;
}

/**
 * Where a registered tool actually dispatches to. Adapters resolve these.
 *
 * @public
 */
export type ToolTarget =
  | { type: 'local'; handlerId: string }
  | { type: 'mcp'; server: string; tool: string }
  | { type: 'http'; method: string; url: string };

/**
 * A tool the gateway will govern. `kind` is part of the descriptor — not
 * something the handler returns.
 *
 * @public
 */
export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly target: ToolTarget;
}

/**
 * A request to invoke a tool through the gateway.
 *
 * @public
 */
export interface InvocationRequest {
  principal: Principal;
  sessionId: string;
  tool: string;
  input: unknown;
  /**
   * When set, this invocation is the human-approved execution of a prior
   * proposal with this id. The gateway verifies the proposal is approved and
   * matches this request before executing.
   */
  approvedProposalId?: string;
}

/**
 * The outcome of an invocation.
 *
 * @public
 */
export interface InvocationResult {
  status: 'executed' | 'proposed' | 'denied' | 'error';
  output?: unknown;
  proposal?: Proposal;
  /** Populated for `denied` and `error`. */
  reason?: string;
  /** Id of the audit event recorded for this invocation. */
  auditId: string;
}

/**
 * A drafted action awaiting human approval.
 *
 * @public
 */
export interface Proposal {
  id: string;
  principal: Principal;
  sessionId: string;
  tool: string;
  input: unknown;
  kind: ToolKind;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

/**
 * The policy decision for a (principal, tool) pair.
 *
 * @public
 */
export type PolicyDecision = 'allow' | 'deny' | 'require_approval';

/**
 * One immutable audit record. Every invocation produces exactly one.
 *
 * @public
 */
export interface AuditEvent {
  id: string;
  ts: number;
  principalId: string;
  sessionId: string;
  tool: string;
  kind: ToolKind | 'unknown';
  decision: PolicyDecision | 'unknown';
  outcome: InvocationResult['status'];
  reason?: string;
}

/**
 * Per-session budget caps. Extensible (tokens, cost) in later versions.
 *
 * @public
 */
export interface BudgetLimits {
  maxCalls: number;
  maxWriteCalls: number;
  maxWallclockMs: number;
}

/**
 * Executes a resolved tool call against a downstream system.
 *
 * @public
 */
export interface Adapter {
  /**
   * Execute the tool. Throwing is allowed; the gateway converts a throw into
   * an `error` outcome and records it.
   */
  execute(descriptor: ToolDescriptor, input: unknown): Promise<unknown>;
}
