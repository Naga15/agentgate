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
import {
  McpAdapter,
  McpClient,
  McpClientFactory,
  McpToolInfo,
} from './McpAdapter';
import { PolicyEngine } from './PolicyEngine';
import { InMemoryProposalStore } from './ProposalStore';
import { ToolRegistry } from './ToolRegistry';

const TOOLS: McpToolInfo[] = [
  { name: 'read_file', description: 'read a file', annotations: { readOnlyHint: true } },
  { name: 'delete_path', description: 'delete', annotations: { destructiveHint: true } },
  { name: 'do_thing', description: 'unannotated' },
];

/** A stub MCP client that records calls and returns canned data. */
function stubClient(overrides: Partial<McpClient> = {}): McpClient & {
  calls: { name: string; arguments?: Record<string, unknown> }[];
  closed: boolean;
} {
  const calls: { name: string; arguments?: Record<string, unknown> }[] = [];
  return {
    calls,
    closed: false,
    async listTools() {
      return { tools: TOOLS };
    },
    async callTool(params) {
      calls.push(params);
      return { content: [{ type: 'text', text: `ran ${params.name}` }] };
    },
    async close() {
      (this as any).closed = true;
    },
    ...overrides,
  };
}

describe('McpAdapter', () => {
  it('discovers tools and assigns kinds from annotations', async () => {
    const client = stubClient();
    const factory: McpClientFactory = async () => client;
    const adapter = new McpAdapter([{ name: 'fs', command: 'x' }], {
      clientFactory: factory,
    });

    const descriptors = await adapter.discoverTools('fs');
    const byName = Object.fromEntries(descriptors.map(d => [d.name, d]));

    expect(byName.read_file.kind).toBe('read'); // readOnlyHint
    expect(byName.delete_path.kind).toBe('write'); // destructiveHint
    expect(byName.do_thing.kind).toBe('write'); // default: fail closed
    expect(byName.read_file.target).toEqual({ type: 'mcp', server: 'fs', tool: 'read_file' });
  });

  it('honors an explicit kindFor override and a custom defaultKind', async () => {
    const adapter = new McpAdapter([{ name: 'fs', command: 'x' }], {
      clientFactory: async () => stubClient(),
    });
    const descriptors = await adapter.discoverTools('fs', {
      kindFor: t => (t.name === 'do_thing' ? 'propose' : undefined),
      defaultKind: 'propose',
    });
    const byName = Object.fromEntries(descriptors.map(d => [d.name, d]));
    expect(byName.do_thing.kind).toBe('propose'); // explicit override
    expect(byName.read_file.kind).toBe('read'); // annotation still wins over default
  });

  it('executes a call by dispatching to the right MCP tool', async () => {
    const client = stubClient();
    const adapter = new McpAdapter([{ name: 'fs', command: 'x' }], {
      clientFactory: async () => client,
    });
    const out = await adapter.execute(
      { name: 'read_file', description: '', kind: 'read', target: { type: 'mcp', server: 'fs', tool: 'read_file' } },
      { path: '/etc/hosts' },
    );
    expect(client.calls).toEqual([{ name: 'read_file', arguments: { path: '/etc/hosts' } }]);
    expect(out).toMatchObject({ content: [{ text: 'ran read_file' }] });
  });

  it('rejects a non-mcp target', async () => {
    const adapter = new McpAdapter([], { clientFactory: async () => stubClient() });
    await expect(
      adapter.execute(
        { name: 'x', description: '', kind: 'read', target: { type: 'local', handlerId: 'x' } },
        {},
      ),
    ).rejects.toThrow(/cannot execute target of type 'local'/);
  });

  it('connects lazily and reuses one connection per server', async () => {
    let connects = 0;
    const client = stubClient();
    const adapter = new McpAdapter([{ name: 'fs', command: 'x' }], {
      clientFactory: async () => {
        connects += 1;
        return client;
      },
    });
    await adapter.discoverTools('fs');
    await adapter.execute(
      { name: 'read_file', description: '', kind: 'read', target: { type: 'mcp', server: 'fs', tool: 'read_file' } },
      {},
    );
    expect(connects).toBe(1); // single shared connection
  });

  it('does not cache a failed connection (retry can recover)', async () => {
    let attempts = 0;
    const adapter = new McpAdapter([{ name: 'fs', command: 'x' }], {
      clientFactory: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('spawn failed');
        return stubClient();
      },
    });
    await expect(adapter.discoverTools('fs')).rejects.toThrow(/spawn failed/);
    // second attempt succeeds because the failed promise was evicted
    const descriptors = await adapter.discoverTools('fs');
    expect(descriptors).toHaveLength(TOOLS.length);
    expect(attempts).toBe(2);
  });

  it('rejects an unknown server name', async () => {
    const adapter = new McpAdapter([{ name: 'fs', command: 'x' }], {
      clientFactory: async () => stubClient(),
    });
    await expect(adapter.discoverTools('nope')).rejects.toThrow(/unknown MCP server: 'nope'/);
  });

  it('end-to-end: governs a discovered MCP write tool through the Gateway', async () => {
    const client = stubClient();
    const mcp = new McpAdapter([{ name: 'fs', command: 'x' }], {
      clientFactory: async () => client,
    });
    const descriptors = await mcp.discoverTools('fs');

    const gateway = new Gateway({
      registry: new ToolRegistry(descriptors),
      policy: new PolicyEngine(),
      audit: new InMemoryAuditLog(),
      proposals: new InMemoryProposalStore(),
      budget: new BudgetTracker({ maxCalls: 50, maxWriteCalls: 50, maxWallclockMs: 60_000 }),
      adapters: { mcp, local: new LocalAdapter() },
    });

    // read tool just runs
    const read = await gateway.invoke({
      principal: { id: 'agent', type: 'agent' },
      sessionId: 's',
      tool: 'read_file',
      input: { path: '/x' },
    });
    expect(read.status).toBe('executed');

    // destructive tool requires approval — never auto-executes
    const del = await gateway.invoke({
      principal: { id: 'agent', type: 'agent' },
      sessionId: 's',
      tool: 'delete_path',
      input: { path: '/x' },
    });
    expect(del.status).toBe('proposed');
    // the MCP server was never asked to delete
    expect(client.calls.map(c => c.name)).toEqual(['read_file']);
  });
});
