/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A narrated, zero-setup walkthrough of agentgate.
 *
 * Scenario: the "orders-api" service has a p99 latency spike. An AI agent is
 * asked to investigate. We watch what the gateway lets it do — and what it
 * makes it ask permission for.
 *
 * Run it:   yarn demo
 *
 * Everything here uses the in-process LocalAdapter, so there's nothing to
 * install or spin up. Swap LocalAdapter for McpAdapter and the exact same
 * gateway governs a real Model Context Protocol server instead.
 */

import {
  Gateway,
  ToolRegistry,
  PolicyEngine,
  InMemoryAuditLog,
  BudgetTracker,
  InMemoryProposalStore,
  LocalAdapter,
  InvocationResult,
  Principal,
} from '../src';
import * as readline from 'node:readline';

// --- tiny console helpers (no dependencies) ---------------------------------
// Run `yarn demo --pause` to step act-by-act (waits for Enter) — use this on
// stage so you can narrate. Plain `yarn demo` runs straight through.
const PAUSE = process.argv.includes('--pause');
const line = () => console.log('─'.repeat(74));
const pause = (): Promise<void> =>
  !PAUSE
    ? Promise.resolve()
    : new Promise<void>(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('\n   ⏎  (press Enter for the next act)', () => {
          rl.close();
          resolve();
        });
      });
const section = async (t: string) => {
  await pause();
  console.log('');
  line();
  console.log(`  ${t}`);
  line();
};
const icon: Record<InvocationResult['status'], string> = {
  executed: '✅ EXECUTED',
  proposed: '⏸  PROPOSED (awaiting human approval)',
  denied: '⛔ DENIED',
  error: '💥 ERROR',
};
function show(label: string, r: InvocationResult) {
  console.log(`\n▶ ${label}`);
  console.log(`   → ${icon[r.status]}`);
  if (r.output !== undefined) console.log(`   output: ${JSON.stringify(r.output)}`);
  if (r.proposal) console.log(`   proposal: ${r.proposal.id} (${r.proposal.tool}, kind=${r.proposal.kind})`);
  if (r.reason) console.log(`   reason: ${r.reason}`);
}

async function main() {
  // --- 1. The downstream tools the agent may use -----------------------------
  // Each is just a function. In real life these are MCP servers, Backstage
  // actions, Kubernetes calls, HTTP APIs — behind the same adapter interface.
  const adapter = new LocalAdapter();
  adapter.register('query_logs', async (i: any) => ({ lines: 3, sample: `p99=2.1s for ${i.service}` }));
  adapter.register('get_recent_deploys', async (i: any) => ({ last: 'orders-api@v41 deployed 14:02' }));
  adapter.register('post_slack_summary', async (i: any) => ({ posted: true }));
  adapter.register('rollback_deploy', async (i: any) => ({ rolledBack: `${i.app} → ${i.toRevision}` }));
  adapter.register('page_oncall', async (i: any) => ({ paged: i.rotation }));

  // --- 2. Register them WITH A KIND ------------------------------------------
  // kind is fixed here, at registration. read = safe; write = can mutate the
  // world. This is the single source of truth for "what can do damage".
  const registry = new ToolRegistry([
    { name: 'query_logs',        description: 'Read service logs',        kind: 'read',  target: { type: 'local', handlerId: 'query_logs' } },
    { name: 'get_recent_deploys',description: 'Read recent deploys',      kind: 'read',  target: { type: 'local', handlerId: 'get_recent_deploys' } },
    { name: 'post_slack_summary',description: 'Draft an incident summary',kind: 'propose',target:{ type: 'local', handlerId: 'post_slack_summary' } },
    { name: 'rollback_deploy',   description: 'Roll back a deployment',   kind: 'write', target: { type: 'local', handlerId: 'rollback_deploy' } },
    { name: 'page_oncall',       description: 'Page the on-call rotation',kind: 'write', target: { type: 'local', handlerId: 'page_oncall' } },
  ]);

  // --- 3. Policy --------------------------------------------------------------
  // Defaults: read auto-runs, write/propose need approval. Plus one explicit
  // rule: an UNTRUSTED principal can't even propose a rollback — hard deny.
  const policy = new PolicyEngine({
    rules: [
      { when: { principalId: 'untrusted-agent' }, tool: 'rollback_deploy', effect: 'deny' },
    ],
  });

  const audit = new InMemoryAuditLog();
  const gateway = new Gateway({
    registry,
    policy,
    audit,
    proposals: new InMemoryProposalStore(),
    budget: new BudgetTracker({ maxCalls: 8, maxWriteCalls: 2, maxWallclockMs: 60_000 }),
    adapters: { local: adapter },
  });

  const agent: Principal = { id: 'sre-agent', type: 'agent' };
  const sid = 'incident-7';

  console.log('\n  agentgate demo — governing an SRE incident-triage agent');
  console.log('  scenario: orders-api p99 latency spiked. The agent investigates.');

  // --- ACT 1: the agent reads to investigate (reads just run) -----------------
  await section('ACT 1 — Investigate: read-only tools run automatically');
  show('agent: query_logs(orders-api)',
    await gateway.invoke({ principal: agent, sessionId: sid, tool: 'query_logs', input: { service: 'orders-api' } }));
  show('agent: get_recent_deploys(orders-api)',
    await gateway.invoke({ principal: agent, sessionId: sid, tool: 'get_recent_deploys', input: { service: 'orders-api' } }));

  // --- ACT 2: the agent wants to ACT (writes become proposals) ----------------
  await section('ACT 2 — Act: destructive tools become proposals, never auto-run');
  const draft = await gateway.invoke({ principal: agent, sessionId: sid, tool: 'post_slack_summary', input: { text: 'p99 spike traced to v41' } });
  show('agent: post_slack_summary(...)  [kind=propose]', draft);

  const rb = await gateway.invoke({ principal: agent, sessionId: sid, tool: 'rollback_deploy', input: { app: 'orders-api', toRevision: 'v40' } });
  show('agent: rollback_deploy(orders-api → v40)  [kind=write]', rb);
  console.log('\n   ☝ The agent did NOT roll anything back. It drafted a proposal.');
  console.log('     The rollback handler was never called.');

  // --- ACT 3: a human approves, THEN it executes ------------------------------
  await section('ACT 3 — A human approves the rollback; only now does it execute');
  gateway.proposals.approve(rb.proposal!.id);
  console.log(`   human approved proposal ${rb.proposal!.id}`);
  const executed = await gateway.invoke({
    principal: agent, sessionId: sid, tool: 'rollback_deploy',
    input: { app: 'orders-api', toRevision: 'v40' },
    approvedProposalId: rb.proposal!.id,
  });
  show('re-invoke rollback_deploy with the approved proposal', executed);

  console.log('\n   Tamper check: try to reuse that approval for a DIFFERENT input…');
  const tampered = await gateway.invoke({
    principal: agent, sessionId: sid, tool: 'rollback_deploy',
    input: { app: 'payments-api', toRevision: 'v1' }, // not what was approved!
    approvedProposalId: rb.proposal!.id,
  });
  show('re-invoke with mismatched input', tampered);

  // --- ACT 4: the leash — a runaway agent hits the budget --------------------
  // Fresh session so the per-session cap of 8 lines up exactly with the loop.
  await section('ACT 4 — The leash: a looping agent runs out of budget (cap = 8 calls/session)');
  const runaway = 'runaway-1';
  for (let i = 1; i <= 10; i++) {
    const r = await gateway.invoke({ principal: agent, sessionId: runaway, tool: 'query_logs', input: { service: 'orders-api', n: i } });
    if (r.status === 'denied') {
      show(`loop call #${i}`, r);
      break;
    }
  }
  console.log('\n   ☝ Eight calls ran; the 9th was denied. A prompt-injected or');
  console.log('     buggy agent cannot spend without bound.');

  // --- ACT 5: prompt-injection defense — untrusted principal -----------------
  await section('ACT 5 — An untrusted agent tries the same rollback');
  const evil = await gateway.invoke({
    principal: { id: 'untrusted-agent', type: 'agent' }, sessionId: 'inj-1',
    tool: 'rollback_deploy', input: { app: 'orders-api', toRevision: 'v0' },
  });
  show('untrusted-agent: rollback_deploy(...)', evil);
  console.log('\n   ☝ Policy denied it outright — it never even became a proposal.');

  // --- The receipts: every decision was recorded -----------------------------
  await section('THE AUDIT LOG — every decision, on every path, recorded');
  for (const e of audit.all()) {
    console.log(
      `   ${e.id.padEnd(9)} ${e.principalId.padEnd(16)} ${e.tool.padEnd(20)} ` +
      `kind=${String(e.kind).padEnd(8)} ${e.decision.padEnd(16)} → ${e.outcome}`,
    );
  }

  await section('Takeaways');
  console.log('   • reads run; writes/proposes need a human; deny is enforced centrally');
  console.log('   • an approval is bound to the EXACT request (no bait-and-switch)');
  console.log('   • budgets bound a runaway agent; everything is audited');
  console.log('   • swap LocalAdapter → McpAdapter and this governs a real MCP server\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
