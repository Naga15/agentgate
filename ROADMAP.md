# Roadmap

This roadmap is public and evolving. Dates are intentionally omitted; this is
a community project and priorities shift with contributor interest. Issues
labeled [`help wanted`](https://github.com/Naga15/agentgate/labels/help%20wanted)
and [`good first issue`](https://github.com/Naga15/agentgate/labels/good%20first%20issue)
track concrete entry points.

## v0.1 — kernel (current)

The governed-invocation core, fully tested, no external dependencies beyond
`zod`.

- [x] `ToolRegistry` with `read | propose | write` kinds
- [x] `PolicyEngine` — default-by-kind effects + ordered allow/deny/require-approval rules
- [x] `BudgetTracker` — per-session call / write / wall-clock caps
- [x] `ProposalStore` — pending → approved/rejected lifecycle
- [x] `AuditLog` — append-only event record (in-memory reference impl)
- [x] `Gateway` — registry → policy → budget → execute|propose, with audit on every path
- [x] `LocalAdapter` — in-process handlers for tests and embedding

## v0.2 — real adapters _(seeking owners)_

Each is a self-contained subproject and a natural maintainership on-ramp.

- [ ] **MCP adapter** — front any Model Context Protocol server; map MCP tools
      to gateway tools with declared kinds
- [ ] **Backstage adapter** — invoke Backstage actions / plugins through the
      gateway (composes with the existing `@theplatformlog` AI plugins)
- [ ] **Kubernetes adapter** — read/propose/write against the K8s API with
      kind-aware mapping (get = read, apply/delete = write)
- [ ] **HTTP adapter** — generic REST endpoints with per-method kind mapping

## v0.3 — durable governance

- [ ] Persistent `AuditLog` backends (JSONL, SQL, OpenTelemetry export)
- [ ] Attribute-based policy (team / environment / time-of-day rules)
- [ ] Budget extensions: token and dollar caps (composing model pricing)
- [ ] Proposal expiry + notifications

## v0.4 — the human in the loop

- [ ] Minimal approval UI (list pending proposals, approve/reject, see diff)
- [ ] Webhook / Slack approval flow
- [ ] Backstage frontend plugin surfacing proposals in the portal

## Beyond

- [ ] Multi-gateway federation
- [ ] Policy-as-code import (OPA/Rego, Cedar)
- [ ] Signed audit chains
- [ ] CNCF Sandbox application (see [SANDBOX.md](./SANDBOX.md))

## Non-goals

`agentgate` is **not** an agent framework, an LLM provider, or a general API
gateway. It governs *agent tool calls* against a platform. Keeping the scope
narrow is deliberate.
