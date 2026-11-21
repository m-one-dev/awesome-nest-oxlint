import { describe, expect, it } from 'vitest';

import { isDeclarationFile } from '../../src/types/type-service.js';

describe('isDeclarationFile', () => {
  it.each([
    '/repo/src/entity.d.ts',
    '/repo/node_modules/pkg/index.d.mts',
    '/repo/node_modules/pkg/index.d.cts',
    '/repo/src/styles.d.css.ts',
  ])('%s is a declaration file', (fileName) => {
    expect(isDeclarationFile(fileName)).toBe(true);
  });

  it.each(['/repo/src/user.entity.ts', '/repo/src/index.mts', '/repo/src/d.ts', '/repo/src.d.x/user.entity.ts', '/repo/src/styles.d.css'])(
    '%s is not a declaration file',
    (fileName) => {
      expect(isDeclarationFile(fileName)).toBe(false);
    },
  );
});
