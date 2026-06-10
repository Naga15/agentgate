/*
 * Copyright 2026 The agentgate Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { ToolRegistry } from './ToolRegistry';
import { ToolDescriptor } from './types';

const t = (name: string, kind: ToolDescriptor['kind']): ToolDescriptor => ({
  name,
  description: 'x',
  kind,
  target: { type: 'local', handlerId: name },
});

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const r = new ToolRegistry([t('a', 'read')]);
    expect(r.get('a')?.kind).toBe('read');
    expect(r.get('missing')).toBeUndefined();
  });

  it('rejects duplicate registration', () => {
    expect(() => new ToolRegistry([t('a', 'read'), t('a', 'write')])).toThrow(
      /duplicate tool/,
    );
  });

  it('surfaces the write surface for auditing', () => {
    const r = new ToolRegistry([t('a', 'read'), t('b', 'write'), t('c', 'propose'), t('d', 'write')]);
    expect(r.writeTools().map(x => x.name).sort()).toEqual(['b', 'd']);
  });
});
