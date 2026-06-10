/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { ToolDescriptor } from './types';

/**
 * The set of tools the gateway will govern. Registration is the only place a
 * tool's `kind` is set, so the registry is the single source of truth for
 * "which tools can write".
 *
 * @public
 */
export class ToolRegistry {
  private readonly map = new Map<string, ToolDescriptor>();

  constructor(tools: ToolDescriptor[] = []) {
    for (const t of tools) {
      this.add(t);
    }
  }

  add(tool: ToolDescriptor): void {
    if (this.map.has(tool.name)) {
      throw new Error(`duplicate tool registration: ${tool.name}`);
    }
    this.map.set(tool.name, tool);
  }

  get(name: string): ToolDescriptor | undefined {
    return this.map.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.map.values()];
  }

  /** All tools that can mutate the world — the surface worth auditing. */
  writeTools(): ToolDescriptor[] {
    return this.list().filter(t => t.kind === 'write');
  }
}
