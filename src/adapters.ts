/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Adapter, ToolDescriptor } from './types';

/**
 * In-process adapter: tools dispatch to handler functions you register by id.
 * Useful for embedding agentgate in a single process, for tests, and as the
 * reference an MCP/HTTP/Kubernetes adapter is modeled on.
 *
 * @public
 */
export class LocalAdapter implements Adapter {
  private readonly handlers = new Map<
    string,
    (input: unknown) => Promise<unknown>
  >();

  register(handlerId: string, fn: (input: unknown) => Promise<unknown>): void {
    this.handlers.set(handlerId, fn);
  }

  async execute(descriptor: ToolDescriptor, input: unknown): Promise<unknown> {
    if (descriptor.target.type !== 'local') {
      throw new Error(
        `LocalAdapter cannot execute target of type '${descriptor.target.type}'`,
      );
    }
    const fn = this.handlers.get(descriptor.target.handlerId);
    if (!fn) {
      throw new Error(
        `no local handler registered for '${descriptor.target.handlerId}'`,
      );
    }
    return fn(input);
  }
}

/**
 * Routes a tool to the adapter that handles its target type. The gateway
 * holds one of these.
 *
 * @public
 */
export class AdapterRegistry {
  constructor(private readonly adapters: Partial<Record<ToolDescriptor['target']['type'], Adapter>>) {}

  resolve(descriptor: ToolDescriptor): Adapter {
    const adapter = this.adapters[descriptor.target.type];
    if (!adapter) {
      throw new Error(
        `no adapter registered for target type '${descriptor.target.type}'`,
      );
    }
    return adapter;
  }
}
