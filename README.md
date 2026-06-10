# agentgate

**A governed gateway between AI agents and your internal developer platform.**

> Status: **alpha** — a working kernel with a stable core API. Actively
> seeking design feedback and co-maintainers (see
> [CONTRIBUTING](./CONTRIBUTING.md)).

AI agents are starting to act on internal developer platforms — opening PRs,
scaffolding services, querying the catalog, rolling back deployments,
investigating incidents. Today they do it through a patchwork of raw API
keys, bespoke per-tool integrations, and ungoverned MCP servers. There is no
single place to answer the questions an operator actually has:

- **Who** is allowed to invoke **which** tool?
- Which calls only **read**, which **propose**, and which **write**?
- Where is the **audit trail** of everything an agent did?
- What stops a looping or prompt-injected agent from **spending without bound**?
- How does a destructive action become a **human approval** instead of an
  immediate side effect?

`agentgate` is that place: a thin control plane that every agent tool call
passes through, applying **policy, audit, budget, and propose-only**
governance before a call ever reaches a downstream tool (an MCP server, a
Backstage action, a Kubernetes API, an HTTP endpoint).

## The model

Every tool registered with the gateway declares a **kind**:

| kind | meaning | default treatment |
|---|---|---|
| `read` | observes state, no side effects | executed (subject to deny policy) |
| `propose` | drafts a suggested action for a human | always returns a **proposal**, never executes |
| `write` | mutates the world | requires approval → returns a **proposal** unless policy explicitly trusts the principal |

`kind` is part of the tool's type, fixed at registration — so you can audit
your whole tool surface and see exactly which tools can mutate anything.

A call flows through four gates:

```
agent ──▶ [ registry ] ──▶ [ policy ] ──▶ [ budget ] ──▶ [ execute | propose ]
              │                │              │                   │
          known tool?     allow/deny/     within caps?      run adapter, or
          + kind          require-approval                  draft a Proposal
              └────────────────┴──────────────┴──────────────────┴──▶ [ audit ]
```

Nothing executes that wasn't (a) a registered tool, (b) permitted by policy,
(c) within the session's budget, and (d) either non-mutating or backed by an
approved proposal. Every decision — allow, deny, propose, execute, error — is
recorded in an append-only audit log.

## Quickstart

```bash
yarn add agentgate
```

```ts
import {
  Gateway,
  ToolRegistry,
  PolicyEngine,
  InMemoryAuditLog,
  BudgetTracker,
  InMemoryProposalStore,
  LocalAdapter,
} from 'agentgate';

// 1. Register downstream tools, each with a kind.
const adapter = new LocalAdapter();
adapter.register('get_catalog_entity', async input => ({ entity: '...' }));
adapter.register('rollback_deployment', async input => ({ rolledBack: true }));

const registry = new ToolRegistry([
  { name: 'get_catalog_entity', description: 'Read a catalog entity', kind: 'read',  target: { type: 'local', handlerId: 'get_catalog_entity' } },
  { name: 'rollback_deployment', description: 'Roll back a deploy',   kind: 'write', target: { type: 'local', handlerId: 'rollback_deployment' } },
]);

// 2. Declare policy. Read is allowed by default; writes need approval
//    unless a rule trusts the principal.
const policy = new PolicyEngine({
  defaultEffects: { read: 'allow', propose: 'require_approval', write: 'require_approval' },
  rules: [
    // Block a specific agent from a specific tool outright.
    { when: { principalId: 'untrusted-bot' }, tool: 'rollback_deployment', effect: 'deny' },
  ],
});

const gateway = new Gateway({
  registry,
  policy,
  audit: new InMemoryAuditLog(),
  proposals: new InMemoryProposalStore(),
  budget: new BudgetTracker({ maxCalls: 50, maxWriteCalls: 5, maxWallclockMs: 60_000 }),
  adapters: { local: adapter },
});

// 3. A read just runs.
await gateway.invoke({
  principal: { id: 'sre-agent', type: 'agent' },
  sessionId: 'inv-42',
  tool: 'get_catalog_entity',
  input: { ref: 'component:default/orders' },
});
// → { status: 'executed', output: { entity: '...' }, auditId: '...' }

// 4. A write becomes a proposal a human must approve.
const r = await gateway.invoke({
  principal: { id: 'sre-agent', type: 'agent' },
  sessionId: 'inv-42',
  tool: 'rollback_deployment',
  input: { app: 'orders', revision: 'v41' },
});
// → { status: 'proposed', proposal: { id, status: 'pending', ... } }

// 5. After a human approves, the same call executes.
gateway.proposals.approve(r.proposal!.id);
await gateway.invoke({ /* same request */ approvedProposalId: r.proposal!.id });
// → { status: 'executed', ... }
```

## Why this shape

- **Propose-only is enforced centrally, not per-tool.** A prompt-injected or
  runaway agent cannot execute a `write` it wasn't explicitly trusted for —
  the worst it can do is generate a proposal a human ignores.
- **Budgets bound the blast radius.** Call counts, write counts, and
  wall-clock are capped per session; extensible to tokens and dollars.
- **Audit is not optional.** Every call produces an immutable record, so
  "what did the agent do" is always answerable.
- **Adapters keep it neutral.** The kernel doesn't care whether a tool is an
  MCP server, a Backstage action, a Kubernetes call, or an HTTP endpoint —
  those are pluggable adapters behind one interface.

## Where it fits

`agentgate` is deliberately **not** an agent framework and **not** an LLM
provider. It's the *seam* an agent's tool calls pass through. Bring your own
agent loop (the
[`@theplatformlog/llm-agent-loop`](https://www.npmjs.com/package/@theplatformlog/llm-agent-loop)
primitive composes cleanly with it) and your own models; `agentgate` governs
what those tools are allowed to do.

## Project status & direction

This is an early, honest alpha: the kernel works and is tested, the API is
deliberately small, and the roadmap is public ([ROADMAP](./ROADMAP.md)).
The near-term goal is real adapters (MCP, Backstage, Kubernetes), a
persistent audit backend, and a minimal approval UI. We track progress
toward [CNCF Sandbox readiness](./SANDBOX.md) in the open.

**We are looking for co-maintainers and design partners.** If you run AI
agents against an internal platform and care about governing them, open an
issue or see [CONTRIBUTING](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE).
