/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { BudgetTracker } from './BudgetTracker';

describe('BudgetTracker', () => {
  it('allows the first call in a fresh session', () => {
    const b = new BudgetTracker({ maxCalls: 1, maxWriteCalls: 1, maxWallclockMs: 1000 });
    expect(b.check('s', 'read')).toBeNull();
  });

  it('enforces the call cap after usage is recorded', () => {
    const b = new BudgetTracker({ maxCalls: 2, maxWriteCalls: 5, maxWallclockMs: 10_000 });
    b.record('s', 'read');
    expect(b.check('s', 'read')).toBeNull();
    b.record('s', 'read');
    expect(b.check('s', 'read')).toBe('call-cap');
  });

  it('enforces the write-call cap independently of the call cap', () => {
    const b = new BudgetTracker({ maxCalls: 100, maxWriteCalls: 1, maxWallclockMs: 10_000 });
    b.record('s', 'write');
    expect(b.check('s', 'write')).toBe('write-call-cap');
    // reads still fine
    expect(b.check('s', 'read')).toBeNull();
  });

  it('enforces the wall-clock cap', () => {
    let t = 1000;
    const b = new BudgetTracker(
      { maxCalls: 100, maxWriteCalls: 100, maxWallclockMs: 500 },
      () => t,
    );
    b.record('s', 'read'); // startedAt = 1000
    t = 1400;
    expect(b.check('s', 'read')).toBeNull();
    t = 1600; // 600ms elapsed > 500
    expect(b.check('s', 'read')).toBe('wallclock');
  });

  it('tracks sessions independently', () => {
    const b = new BudgetTracker({ maxCalls: 1, maxWriteCalls: 1, maxWallclockMs: 10_000 });
    b.record('a', 'read');
    expect(b.check('a', 'read')).toBe('call-cap');
    expect(b.check('b', 'read')).toBeNull();
  });

  it('exposes a usage snapshot', () => {
    const b = new BudgetTracker({ maxCalls: 10, maxWriteCalls: 10, maxWallclockMs: 10_000 });
    b.record('s', 'write');
    b.record('s', 'read');
    expect(b.usage('s')).toMatchObject({ calls: 2, writeCalls: 1 });
    expect(b.usage('missing')).toBeUndefined();
  });
});
