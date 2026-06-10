# Architecture

`agentgate` is a small kernel with a deliberately narrow job: be the governed
seam every AI-agent tool call passes through. This document describes the
pieces and the path a call takes.

## Components

| Component | Responsibility |
|---|---|
| `ToolRegistry` | The known tools, each with a fixed `kind` (`read` / `propose` / `write`). The single source of truth for "which tools can write." |
| `PolicyEngine` | Decides `allow` / `deny` / `require_approval` for a `(principal, tool)` pair, via kind defaults + ordered rules. |
| `BudgetTracker` | Per-session caps: total calls, write calls, wall-clock. Bounds blast radius. |
| `ProposalStore` | Lifecycle of drafted actions awaiting human approval (`pending → approved/rejected`). |
| `AuditLog` | Append-only record. Exactly one event per invocation, on every path. |
| `Adapter` / `AdapterRegistry` | Execute a resolved call against a downstream system (local handler, MCP server, HTTP, Kubernetes). |
| `Gateway` | Orchestrates the above. The only public entry point for invoking a tool. |

## The invocation path

```
                    InvocationRequest
                          │
                          ▼
                  ┌───────────────┐   unknown tool
                  │  ToolRegistry │ ───────────────▶ denied (audited)
                  └───────┬───────┘
                          │ known tool (+ kind)
                          ▼
              approvedProposalId set?
                 │ yes              │ no
                 ▼                  ▼
        verify proposal      ┌──────────────┐  deny
        matches request      │ PolicyEngine │ ───────▶ denied (audited)
         │ ok    │ mismatch  └──────┬───────┘
         │       └─▶ denied         │ require_approval (or kind=propose)
         │                          ▼
         │                  create Proposal ──▶ proposed (audited)
         ▼                          │ allow
   ┌──────────────┐                 ▼
   │ BudgetTracker│ ◀───────────────┘
   └──────┬───────┘  over budget ──▶ denied (audited)
          │ within
          ▼
   ┌──────────────┐  throws ──▶ error (audited)
   │   Adapter    │
   └──────┬───────┘
          │ ok
          ▼
   record budget usage ──▶ executed (audited)
```

## Design principles

1. **`kind` is structural, not behavioral.** A tool's capacity to mutate is
   declared at registration and checked by the gateway — not inferred from
   what a handler happens to do. This makes the write surface auditable by
   inspection.

2. **Propose-only is enforced centrally.** A `propose` tool never executes,
   and a `write` tool never executes without an approved proposal (unless an
   explicit policy rule trusts the principal). The decision lives in the
   gateway, so no individual tool can forget to gate itself.

3. **Approval is bound to the exact request.** Executing an approved proposal
   re-checks that the principal, tool, and input match what was approved — an
   approved cheap call can't be swapped for a different or more expensive one.

4. **Every path is audited.** Allow, deny, propose, execute, error — each
   produces exactly one immutable audit event. "What did the agent do" is
   always answerable.

5. **The kernel is adapter-neutral.** Downstream systems are pluggable behind
   the `Adapter` interface; the governance logic doesn't know or care whether
   a tool is MCP, HTTP, Kubernetes, or in-process.

## Composing with an agent loop

`agentgate` governs *tool calls*; it is not itself an agent loop. A loop such
as [`@theplatformlog/llm-agent-loop`](https://www.npmjs.com/package/@theplatformlog/llm-agent-loop)
drives the model and decides *which* tool to call; it then routes that call
through `gateway.invoke(...)` instead of executing it directly. The loop owns
"what to try next"; the gateway owns "what is allowed to happen."

## What's intentionally not here (yet)

- Real adapters (MCP, Backstage, Kubernetes) — see [ROADMAP](../ROADMAP.md).
- Durable audit backends — the in-memory log is a reference impl.
- An approval UI — proposals are exposed via the `ProposalStore` API; the UI
  is a planned subproject.
- Token/dollar budgets — the `BudgetLimits` shape is designed to extend.
