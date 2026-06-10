/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { LocalAdapter } from './adapters';
import { InMemoryAuditLog } from './AuditLog';
import { BudgetTracker } from './BudgetTracker';
import { Gateway } from './Gateway';
import { PolicyEngine, PolicyConfig } from './PolicyEngine';
import { InMemoryProposalStore } from './ProposalStore';
import { ToolRegistry } from './ToolRegistry';
import { InvocationRequest, Principal, ToolDescriptor } from './types';

const READ: ToolDescriptor = {
  name: 'get_entity',
  description: 'read a catalog entity',
  kind: 'read',
  target: { type: 'local', handlerId: 'get_entity' },
};
const PROPOSE: ToolDescriptor = {
  name: 'propose_rollback',
  description: 'draft a rollback',
  kind: 'propose',
  target: { type: 'local', handlerId: 'propose_rollback' },
};
const WRITE: ToolDescriptor = {
  name: 'rollback',
  description: 'roll back a deploy',
  kind: 'write',
  target: { type: 'local', handlerId: 'rollback' },
};

const agent: Principal = { id: 'sre-agent', type: 'agent' };

function build(policy: PolicyConfig = {}, budgetOverrides = {}) {
  const adapter = new LocalAdapter();
  adapter.register('get_entity', async () => ({ entity: 'orders' }));
  adapter.register('propose_rollback', async () => ({ drafted: true }));
  adapter.register('rollback', async (input: any) => ({ rolledBack: input }));

  const audit = new InMemoryAuditLog();
  const proposals = new InMemoryProposalStore();
  const gateway = new Gateway({
    registry: new ToolRegistry([READ, PROPOSE, WRITE]),
    policy: new PolicyEngine(policy),
    audit,
    proposals,
    budget: new BudgetTracker({
      maxCalls: 100,
      maxWriteCalls: 100,
      maxWallclockMs: 60_000,
      ...budgetOverrides,
    }),
    adapters: { local: adapter },
  });
  return { gateway, audit, proposals };
}

const req = (over: Partial<InvocationRequest>): InvocationRequest => ({
  principal: agent,
  sessionId: 's1',
  tool: READ.name,
  input: {},
  ...over,
});

describe('Gateway', () => {
  it('read tools execute by default', async () => {
    const { gateway, audit } = build();
    const r = await gateway.invoke(req({ tool: 'get_entity' }));
    expect(r.status).toBe('executed');
    expect(r.output).toEqual({ entity: 'orders' });
    expect(audit.all()).toHaveLength(1);
    expect(audit.all()[0].outcome).toBe('executed');
  });

  it('propose tools never execute — they return a pending proposal', async () => {
    const { gateway, proposals } = build();
    const r = await gateway.invoke(req({ tool: 'propose_rollback' }));
    expect(r.status).toBe('proposed');
    expect(r.output).toBeUndefined();
    expect(r.proposal?.status).toBe('pending');
    expect(proposals.listPending()).toHaveLength(1);
  });

  it('write tools require approval by default → proposal, no execution', async () => {
    const { gateway } = build();
    const r = await gateway.invoke(req({ tool: 'rollback', input: { app: 'orders' } }));
    expect(r.status).toBe('proposed');
    expect(r.proposal?.kind).toBe('write');
  });

  it('an approved proposal executes on re-invocation with the same input', async () => {
    const { gateway } = build();
    const input = { app: 'orders', rev: 'v41' };
    const first = await gateway.invoke(req({ tool: 'rollback', input }));
    expect(first.status).toBe('proposed');

    gateway.proposals.approve(first.proposal!.id);

    const second = await gateway.invoke(
      req({ tool: 'rollback', input, approvedProposalId: first.proposal!.id }),
    );
    expect(second.status).toBe('executed');
    expect(second.output).toEqual({ rolledBack: input });
  });

  it('a mismatched input against an approved proposal is denied', async () => {
    const { gateway } = build();
    const first = await gateway.invoke(req({ tool: 'rollback', input: { app: 'orders' } }));
    gateway.proposals.approve(first.proposal!.id);

    const tampered = await gateway.invoke(
      req({
        tool: 'rollback',
        input: { app: 'payments' }, // different!
        approvedProposalId: first.proposal!.id,
      }),
    );
    expect(tampered.status).toBe('denied');
    expect(tampered.reason).toMatch(/does not match approved proposal/);
  });

  it('executing an unapproved (still pending) proposal is denied', async () => {
    const { gateway } = build();
    const first = await gateway.invoke(req({ tool: 'rollback', input: { app: 'orders' } }));
    const r = await gateway.invoke(
      req({ tool: 'rollback', input: { app: 'orders' }, approvedProposalId: first.proposal!.id }),
    );
    expect(r.status).toBe('denied');
    expect(r.reason).toMatch(/is 'pending', not 'approved'/);
  });

  it('a deny rule blocks a tool outright', async () => {
    const { gateway } = build({
      rules: [{ when: { principalId: 'sre-agent' }, tool: 'get_entity', effect: 'deny' }],
    });
    const r = await gateway.invoke(req({ tool: 'get_entity' }));
    expect(r.status).toBe('denied');
    expect(r.reason).toMatch(/policy denied/);
  });

  it('an allow rule lets a trusted principal execute a write directly', async () => {
    const { gateway } = build({
      rules: [{ when: { principalId: 'sre-agent' }, kind: 'write', effect: 'allow' }],
    });
    const r = await gateway.invoke(req({ tool: 'rollback', input: { app: 'orders' } }));
    expect(r.status).toBe('executed');
  });

  it('unknown tools are denied and audited', async () => {
    const { gateway, audit } = build();
    const r = await gateway.invoke(req({ tool: 'no_such_tool' }));
    expect(r.status).toBe('denied');
    expect(r.reason).toMatch(/unknown tool/);
    expect(audit.all()[0].kind).toBe('unknown');
  });

  it('the per-session call cap denies once exhausted', async () => {
    const { gateway } = build({}, { maxCalls: 2 });
    await gateway.invoke(req({ tool: 'get_entity' })); // 1
    await gateway.invoke(req({ tool: 'get_entity' })); // 2
    const third = await gateway.invoke(req({ tool: 'get_entity' }));
    expect(third.status).toBe('denied');
    expect(third.reason).toMatch(/budget exceeded: call-cap/);
  });

  it('the write-call cap denies writes but the call cap is independent', async () => {
    const { gateway } = build(
      { rules: [{ kind: 'write', effect: 'allow' }] },
      { maxWriteCalls: 1 },
    );
    const first = await gateway.invoke(req({ tool: 'rollback', input: { a: 1 } }));
    expect(first.status).toBe('executed');
    const second = await gateway.invoke(req({ tool: 'rollback', input: { a: 2 } }));
    expect(second.status).toBe('denied');
    expect(second.reason).toMatch(/write-call-cap/);
  });

  it('a throwing handler becomes an error outcome, recorded in audit', async () => {
    const adapter = new LocalAdapter();
    adapter.register('boom', async () => {
      throw new Error('downstream exploded');
    });
    const audit = new InMemoryAuditLog();
    const gateway = new Gateway({
      registry: new ToolRegistry([
        { name: 'boom', description: 'x', kind: 'read', target: { type: 'local', handlerId: 'boom' } },
      ]),
      policy: new PolicyEngine(),
      audit,
      proposals: new InMemoryProposalStore(),
      budget: new BudgetTracker({ maxCalls: 10, maxWriteCalls: 10, maxWallclockMs: 60_000 }),
      adapters: { local: adapter },
    });
    const r = await gateway.invoke(req({ tool: 'boom' }));
    expect(r.status).toBe('error');
    expect(r.reason).toMatch(/threw: downstream exploded/);
    expect(audit.all()[0].outcome).toBe('error');
  });

  it('records exactly one audit event per invocation, on every path', async () => {
    const { gateway, audit } = build();
    await gateway.invoke(req({ tool: 'get_entity' })); // executed
    await gateway.invoke(req({ tool: 'propose_rollback' })); // proposed
    await gateway.invoke(req({ tool: 'no_such_tool' })); // denied
    expect(audit.all()).toHaveLength(3);
    expect(audit.all().map(e => e.outcome)).toEqual([
      'executed',
      'proposed',
      'denied',
    ]);
  });
});
