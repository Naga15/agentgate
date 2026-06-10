/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * agentgate — a governed gateway between AI agents and your internal
 * developer platform.
 *
 * Every agent tool call passes through the {@link Gateway}, which applies
 * policy, audit, budget, and propose-only governance before a call reaches a
 * downstream tool.
 *
 * @packageDocumentation
 */

export { Gateway, type GatewayOptions } from './Gateway';
export { ToolRegistry } from './ToolRegistry';
export {
  PolicyEngine,
  type PolicyConfig,
  type PolicyRule,
  type PrincipalMatch,
} from './PolicyEngine';
export {
  BudgetTracker,
  type BudgetBreach,
} from './BudgetTracker';
export {
  type AuditLog,
  InMemoryAuditLog,
} from './AuditLog';
export {
  type ProposalStore,
  InMemoryProposalStore,
} from './ProposalStore';
export {
  LocalAdapter,
  AdapterRegistry,
} from './adapters';
export type {
  Adapter,
  AuditEvent,
  BudgetLimits,
  InvocationRequest,
  InvocationResult,
  PolicyDecision,
  Principal,
  Proposal,
  ToolDescriptor,
  ToolKind,
  ToolTarget,
} from './types';
