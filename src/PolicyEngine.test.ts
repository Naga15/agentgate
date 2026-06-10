/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { PolicyEngine } from './PolicyEngine';
import { Principal, ToolDescriptor } from './types';

const tool = (kind: ToolDescriptor['kind'], name = 't'): ToolDescriptor => ({
  name,
  description: 'x',
  kind,
  target: { type: 'local', handlerId: name },
});

const p = (id: string, attrs?: Record<string, string>): Principal => ({
  id,
  type: 'agent',
  attributes: attrs,
});

describe('PolicyEngine', () => {
  it('applies kind defaults when no rule matches', () => {
    const e = new PolicyEngine();
    expect(e.decide(p('a'), tool('read'))).toBe('allow');
    expect(e.decide(p('a'), tool('propose'))).toBe('require_approval');
    expect(e.decide(p('a'), tool('write'))).toBe('require_approval');
  });

  it('honors overridden kind defaults', () => {
    const e = new PolicyEngine({ defaultEffects: { write: 'deny' } });
    expect(e.decide(p('a'), tool('write'))).toBe('deny');
    // unspecified kinds keep the builtin default
    expect(e.decide(p('a'), tool('read'))).toBe('allow');
  });

  it('first matching rule wins', () => {
    const e = new PolicyEngine({
      rules: [
        { tool: 't', effect: 'deny' },
        { tool: 't', effect: 'allow' }, // never reached
      ],
    });
    expect(e.decide(p('a'), tool('read', 't'))).toBe('deny');
  });

  it('matches by principal id', () => {
    const e = new PolicyEngine({
      rules: [{ when: { principalId: 'trusted' }, kind: 'write', effect: 'allow' }],
    });
    expect(e.decide(p('trusted'), tool('write'))).toBe('allow');
    expect(e.decide(p('other'), tool('write'))).toBe('require_approval');
  });

  it('matches by attributes (all must equal)', () => {
    const e = new PolicyEngine({
      rules: [{ when: { attributes: { team: 'platform', env: 'staging' } }, effect: 'allow' }],
    });
    expect(e.decide(p('a', { team: 'platform', env: 'staging' }), tool('write'))).toBe('allow');
    expect(e.decide(p('a', { team: 'platform', env: 'prod' }), tool('write'))).toBe(
      'require_approval',
    );
    expect(e.decide(p('a', { team: 'platform' }), tool('write'))).toBe('require_approval');
  });

  it('a kind-scoped rule does not affect other kinds', () => {
    const e = new PolicyEngine({
      rules: [{ kind: 'read', effect: 'deny' }],
    });
    expect(e.decide(p('a'), tool('read'))).toBe('deny');
    expect(e.decide(p('a'), tool('write'))).toBe('require_approval');
  });
});
