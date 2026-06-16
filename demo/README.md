# agentgate demo

A narrated, zero-setup walkthrough of what agentgate does. No external
services, no API keys, no MCP servers to spin up — it uses the in-process
`LocalAdapter`, so it runs anywhere Node does.

## Run it

```bash
yarn install
yarn demo
```

## What it shows

The scenario: the `orders-api` service has a p99 latency spike, and an AI
agent is asked to investigate. You watch the gateway govern it, act by act:

1. **Investigate** — read-only tools (`query_logs`, `get_recent_deploys`) run
   automatically.
2. **Act** — when the agent tries to `rollback_deploy` (a `write`) or draft a
   Slack summary (a `propose`), nothing happens to the world — it comes back
   as a **proposal**. The rollback handler is never called.
3. **Approve** — a human approves the rollback proposal; only *now* does it
   execute. A tampered re-use of that approval (different input) is denied.
4. **The leash** — a looping agent hits the per-session budget cap and is cut
   off at call #9.
5. **Prompt-injection defense** — an `untrusted-agent` principal is denied the
   rollback outright by policy; it never even becomes a proposal.

Finally it prints the **audit log** — every decision, on every path, recorded.

## Make it govern a *real* MCP server

The demo uses `LocalAdapter` for zero setup. To govern an actual Model
Context Protocol server instead, install the optional peer dep and swap the
adapter — the gateway code is identical:

```bash
yarn add @modelcontextprotocol/sdk
```

```ts
import { McpAdapter } from 'agentgate';

const mcp = new McpAdapter([
  { name: 'fs', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'] },
]);
const tools = await mcp.discoverTools('fs'); // kinds inferred from MCP annotations
// new Gateway({ registry: new ToolRegistry(tools), adapters: { mcp }, ... })
```
