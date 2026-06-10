/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Adapter, ToolDescriptor, ToolKind } from './types';

/**
 * Configuration for one MCP server the adapter can reach (stdio transport).
 *
 * @public
 */
export interface McpServerConfig {
  /** Logical name; referenced by a tool's `target.server`. */
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Tool metadata as returned by an MCP server's `tools/list`. Only the fields
 * agentgate uses are modeled; `annotations` follows the MCP tool-annotations
 * shape (`readOnlyHint` / `destructiveHint`).
 *
 * @public
 */
export interface McpToolInfo {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    [k: string]: unknown;
  };
}

/**
 * The minimal MCP client surface agentgate depends on. Implemented by the
 * default stdio factory (which wraps `@modelcontextprotocol/sdk`) and easily
 * stubbed in tests.
 *
 * @public
 */
export interface McpClient {
  listTools(): Promise<{ tools: McpToolInfo[] }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Creates a connected {@link McpClient} for a server. Injectable for tests.
 *
 * @public
 */
export type McpClientFactory = (server: McpServerConfig) => Promise<McpClient>;

/**
 * Options for {@link McpAdapter.discoverTools}.
 *
 * @public
 */
export interface DiscoverOptions {
  /**
   * Decide a tool's kind. Overrides annotation inference. Return `undefined`
   * to fall back to inference / `defaultKind`.
   */
  kindFor?: (tool: McpToolInfo) => ToolKind | undefined;
  /**
   * Kind used when neither `kindFor` nor annotations decide. Defaults to
   * **`write`** — fail closed: an unclassified MCP tool requires approval
   * rather than executing silently.
   */
  defaultKind?: ToolKind;
}

/**
 * Default stdio client factory. Dynamically imports `@modelcontextprotocol/sdk`
 * (an optional peer dependency) so agentgate's core stays dependency-free
 * unless you actually connect to an MCP server.
 */
const defaultClientFactory: McpClientFactory = async server => {
  // Variable specifiers keep the optional SDK out of the compile-time graph;
  // a missing package surfaces as a friendly error.
  const clientPkg = '@modelcontextprotocol/sdk/client/index.js';
  const stdioPkg = '@modelcontextprotocol/sdk/client/stdio.js';
  let ClientMod: any;
  let StdioMod: any;
  try {
    ClientMod = await import(clientPkg);
    StdioMod = await import(stdioPkg);
  } catch {
    throw new Error(
      "McpAdapter requires the '@modelcontextprotocol/sdk' package. " +
        'Install it in your project: yarn add @modelcontextprotocol/sdk',
    );
  }
  const transport = new StdioMod.StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: server.env,
  });
  const client = new ClientMod.Client(
    { name: 'agentgate', version: '0.1.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return {
    listTools: () => client.listTools(),
    callTool: params => client.callTool(params),
    close: () => client.close(),
  };
};

/**
 * Infer a kind from MCP tool annotations. `readOnlyHint` → `read`,
 * `destructiveHint` → `write`. Anything else is left undecided so the caller
 * (or `defaultKind`) chooses — and the default is the safe `write`.
 */
function inferKind(tool: McpToolInfo): ToolKind | undefined {
  if (tool.annotations?.readOnlyHint === true) return 'read';
  if (tool.annotations?.destructiveHint === true) return 'write';
  return undefined;
}

/**
 * Fronts one or more MCP servers so their tools can be governed by the
 * {@link Gateway}. Connections are lazy (established on first use per server)
 * and a failed connection is not cached, so retries can recover.
 *
 * Two responsibilities:
 *
 * - {@link discoverTools} turns an MCP server's advertised tools into
 *   {@link ToolDescriptor}s with a governance `kind` (so they can be
 *   registered with a {@link ToolRegistry}).
 * - {@link execute} dispatches a governed call to the right server/tool.
 *
 * @public
 */
export class McpAdapter implements Adapter {
  private readonly servers = new Map<string, McpServerConfig>();
  private readonly clients = new Map<string, Promise<McpClient>>();
  private readonly factory: McpClientFactory;
  private readonly callTimeoutMs?: number;

  constructor(
    servers: McpServerConfig[],
    opts: { clientFactory?: McpClientFactory; callTimeoutMs?: number } = {},
  ) {
    for (const s of servers) {
      if (this.servers.has(s.name)) {
        throw new Error(`duplicate MCP server name: ${s.name}`);
      }
      this.servers.set(s.name, s);
    }
    this.factory = opts.clientFactory ?? defaultClientFactory;
    this.callTimeoutMs = opts.callTimeoutMs;
  }

  /**
   * List a server's tools as governable descriptors. Assigns each a `kind`
   * (caller override → annotation inference → `defaultKind`, which is `write`).
   */
  async discoverTools(
    serverName: string,
    opts: DiscoverOptions = {},
  ): Promise<ToolDescriptor[]> {
    const client = await this.clientFor(serverName);
    const { tools } = await client.listTools();
    const fallback = opts.defaultKind ?? 'write';
    return tools.map(t => ({
      name: t.name,
      description: t.description ?? '',
      kind: opts.kindFor?.(t) ?? inferKind(t) ?? fallback,
      target: { type: 'mcp' as const, server: serverName, tool: t.name },
    }));
  }

  async execute(descriptor: ToolDescriptor, input: unknown): Promise<unknown> {
    if (descriptor.target.type !== 'mcp') {
      throw new Error(
        `McpAdapter cannot execute target of type '${descriptor.target.type}'`,
      );
    }
    const { server, tool } = descriptor.target;
    const client = await this.clientFor(server);
    const call = client.callTool({
      name: tool,
      arguments: (input ?? {}) as Record<string, unknown>,
    });
    return this.callTimeoutMs ? this.withTimeout(call, tool) : call;
  }

  /** Close all open MCP connections. Call on shutdown. */
  async close(): Promise<void> {
    const open = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(
      open.map(async p => {
        try {
          await (await p).close();
        } catch {
          /* best-effort */
        }
      }),
    );
  }

  private clientFor(name: string): Promise<McpClient> {
    const cached = this.clients.get(name);
    if (cached) return cached;

    const config = this.servers.get(name);
    if (!config) {
      return Promise.reject(new Error(`unknown MCP server: '${name}'`));
    }

    // Do not cache a failed connection — drop it so a later call can retry.
    const pending = this.factory(config).catch(err => {
      this.clients.delete(name);
      throw err;
    });
    this.clients.set(name, pending);
    return pending;
  }

  private async withTimeout<T>(p: Promise<T>, tool: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `MCP tool '${tool}' timed out after ${this.callTimeoutMs}ms`,
            ),
          ),
        this.callTimeoutMs,
      );
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
