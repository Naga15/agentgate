/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { AuditEvent } from './types';

/**
 * Append-only sink for audit events. Implementations must never drop or
 * mutate a recorded event. The gateway records exactly one event per
 * invocation, on every path (allow, deny, propose, execute, error).
 *
 * @public
 */
export interface AuditLog {
  /** Record an event and return its assigned id. */
  record(event: Omit<AuditEvent, 'id'>): string;
}

/**
 * In-memory reference `AuditLog`. Suitable for tests and embedding; swap for
 * a durable backend (JSONL / SQL / OTel) in production.
 *
 * @public
 */
export class InMemoryAuditLog implements AuditLog {
  private readonly events: AuditEvent[] = [];
  private seq = 0;

  record(event: Omit<AuditEvent, 'id'>): string {
    const id = `audit-${++this.seq}`;
    this.events.push({ id, ...event });
    return id;
  }

  /** Read back the recorded events (newest last). Read-only copy. */
  all(): AuditEvent[] {
    return [...this.events];
  }

  /** Convenience filter for a single session's trail. */
  forSession(sessionId: string): AuditEvent[] {
    return this.events.filter(e => e.sessionId === sessionId);
  }
}
