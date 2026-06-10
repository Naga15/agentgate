/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Principal, PolicyDecision, ToolDescriptor, ToolKind } from './types';

/**
 * Matches a principal. All present fields must match (AND). An absent field
 * matches anything.
 *
 * @public
 */
export interface PrincipalMatch {
  principalId?: string;
  type?: Principal['type'];
  /** All listed attributes must equal the principal's. */
  attributes?: Record<string, string>;
}

/**
 * A single ordered policy rule. The first rule whose `when` and `tool`/`kind`
 * match decides the outcome.
 *
 * @public
 */
export interface PolicyRule {
  when?: PrincipalMatch;
  /** Match a specific tool by name. Omit to match any tool. */
  tool?: string;
  /** Match by kind. Omit to match any kind. */
  kind?: ToolKind;
  effect: PolicyDecision;
}

/**
 * @public
 */
export interface PolicyConfig {
  /** Decision applied when no rule matches, keyed by kind. */
  defaultEffects?: Partial<Record<ToolKind, PolicyDecision>>;
  rules?: PolicyRule[];
}

const BUILTIN_DEFAULTS: Record<ToolKind, PolicyDecision> = {
  read: 'allow',
  propose: 'require_approval',
  write: 'require_approval',
};

/**
 * Decides allow / deny / require-approval for a (principal, tool) pair.
 *
 * Evaluation: ordered rules, first match wins; if none match, the
 * kind-defaulted effect applies (`read`→allow, `propose`/`write`→
 * require_approval unless overridden).
 *
 * @public
 */
export class PolicyEngine {
  private readonly defaults: Record<ToolKind, PolicyDecision>;
  private readonly rules: PolicyRule[];

  constructor(config: PolicyConfig = {}) {
    this.defaults = { ...BUILTIN_DEFAULTS, ...config.defaultEffects };
    this.rules = config.rules ?? [];
  }

  decide(principal: Principal, tool: ToolDescriptor): PolicyDecision {
    for (const rule of this.rules) {
      if (rule.tool !== undefined && rule.tool !== tool.name) continue;
      if (rule.kind !== undefined && rule.kind !== tool.kind) continue;
      if (!this.matchesPrincipal(rule.when, principal)) continue;
      return rule.effect;
    }
    return this.defaults[tool.kind];
  }

  private matchesPrincipal(
    match: PrincipalMatch | undefined,
    principal: Principal,
  ): boolean {
    if (!match) return true;
    if (match.principalId !== undefined && match.principalId !== principal.id) {
      return false;
    }
    if (match.type !== undefined && match.type !== principal.type) {
      return false;
    }
    if (match.attributes) {
      const attrs = principal.attributes ?? {};
      for (const [k, v] of Object.entries(match.attributes)) {
        if (attrs[k] !== v) return false;
      }
    }
    return true;
  }
}
