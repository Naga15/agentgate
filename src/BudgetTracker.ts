/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { BudgetLimits, ToolKind } from './types';

interface SessionUsage {
  calls: number;
  writeCalls: number;
  startedAt: number;
}

/**
 * The reason a budget check failed, or `null` if within budget.
 *
 * @public
 */
export type BudgetBreach =
  | 'call-cap'
  | 'write-call-cap'
  | 'wallclock'
  | null;

/**
 * Per-session budget enforcement. Caps total calls, write calls, and
 * wall-clock per session. Designed to bound the blast radius of a looping or
 * prompt-injected agent.
 *
 * The gateway calls {@link check} before executing and {@link record} after a
 * successful execution.
 *
 * @public
 */
export class BudgetTracker {
  private readonly limits: BudgetLimits;
  private readonly sessions = new Map<string, SessionUsage>();
  private readonly now: () => number;

  constructor(limits: BudgetLimits, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  /**
   * Returns the breached limit, or `null` if a call of `kind` is within
   * budget for `sessionId`. Does not mutate usage.
   */
  check(sessionId: string, kind: ToolKind): BudgetBreach {
    const usage = this.sessions.get(sessionId);
    if (!usage) return null; // first call in the session is always allowed

    if (this.now() - usage.startedAt > this.limits.maxWallclockMs) {
      return 'wallclock';
    }
    if (usage.calls >= this.limits.maxCalls) {
      return 'call-cap';
    }
    if (kind === 'write' && usage.writeCalls >= this.limits.maxWriteCalls) {
      return 'write-call-cap';
    }
    return null;
  }

  /** Record a completed execution against the session's budget. */
  record(sessionId: string, kind: ToolKind): void {
    const usage = this.sessions.get(sessionId) ?? {
      calls: 0,
      writeCalls: 0,
      startedAt: this.now(),
    };
    usage.calls += 1;
    if (kind === 'write') usage.writeCalls += 1;
    this.sessions.set(sessionId, usage);
  }

  /** Current usage snapshot for a session (for inspection / UI). */
  usage(sessionId: string): Readonly<SessionUsage> | undefined {
    const u = this.sessions.get(sessionId);
    return u ? { ...u } : undefined;
  }
}
