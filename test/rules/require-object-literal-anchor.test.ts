import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { requireObjectLiteralAnchor } from '../../src/rules/require-object-literal-anchor.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');

const filename = path.join(fixturesDir, 'require-object-literal-anchor.ts');

const ruleTester = new RuleTester();

const preamble = `
  interface UserDto { id: number; name: string; }
  interface EventDto { id: number; title: string; }
  declare function take(dto: UserDto): void;
  declare function takeLoose(value: any): void;
`;

// Expectations from TypeScript 5.9's checker.getContextualType, which the typescript-eslint
// version asked: tsrs (TypeScript 7) must leave the same literals without a contextual type.
const parity: ReadonlyArray<{ name: string; code: string; unanchored: ReadonlyArray<readonly [number, number]> }> = [
  {
    name: 'a literal nested in an unanchored literal',
    code: 'const cfg = { a: { b: 1 } };',
    unanchored: [[1, 12], [1, 17]],
  },
  {
    name: 'argument to a generic parameter',
    code: 'declare function wrap<T>(value: T): T;\nwrap({ a: 1 });',
    unanchored: [],
  },
  {
    name: 'arrow body returned to Array#map',
    code: '[1].map((x) => ({ a: x }));',
    unanchored: [],
  },
  {
    name: 'argument to Promise.resolve',
    code: 'Promise.resolve({ a: 1 });',
    unanchored: [],
  },
  {
    name: 'return of an unannotated async function',
    code: 'async function f() { return { a: 1 }; }',
    unanchored: [[1, 28]],
  },
  {
    name: 'unannotated class property initializer',
    code: 'class C { x = { a: 1 }; }',
    unanchored: [[1, 14]],
  },
  {
    name: 'unannotated default parameter',
    code: 'function f(o = { a: 1 }) { return o; }',
    unanchored: [[1, 15]],
  },
  {
    name: 'literal spread into an annotated literal',
    code: 'const base = { a: 1 };\nconst u: { a: number; b: number } = { ...base, b: 2 };',
    unanchored: [[1, 13]],
  },
  {
    name: 'arguments to Object.assign',
    code: 'Object.assign({}, { a: 1 });',
    unanchored: [],
  },
  {
    name: 'argument to JSON.stringify',
    code: 'JSON.stringify({ a: 1 });',
    unanchored: [],
  },
  {
    name: 'branches of a ternary with an annotated target',
    code: 'declare const c: boolean;\nconst u: { a: number } = c ? { a: 1 } : { a: 2 };',
    unanchored: [],
  },
  {
    name: 'return of an arrow typed by its variable',
    code: 'const f: () => { a: number } = () => ({ a: 1 });',
    unanchored: [],
  },
  {
    name: 'argument to an overloaded function',
    code: 'declare function o(x: string): void;\ndeclare function o(x: { a: number }): void;\no({ a: 1 });',
    unanchored: [],
  },
  {
    name: 'export default',
    code: 'export default { a: 1 };',
    unanchored: [[1, 15]],
  },
  {
    name: 'decorator argument',
    code: 'function D(o: { a: number }): ClassDecorator { return () => {}; }\n@D({ a: 1 })\nclass K {}',
    unanchored: [],
  },
  {
    name: 'element of an unannotated array',
    code: 'const x = [{ a: 1 }];',
    unanchored: [[1, 11]],
  },
  {
    name: 'awaited Promise.resolve in an annotated return',
    code: 'async function g(): Promise<{ a: number }> { return await Promise.resolve({ a: 1 }); }',
    unanchored: [],
  },
  {
    name: 'assignment to an annotated variable',
    code: 'let o: { a: { b: number } };\no = { a: { b: 1 } };',
    unanchored: [],
  },
  {
    name: 'entry passed to new Map',
    code: 'new Map([[\'k\', { a: 1 }]]);',
    unanchored: [],
  },
  {
    name: 'return of a callback inferring a type parameter',
    code: 'declare function make<T>(f: () => T): T;\nmake(() => ({ a: 1 }));',
    unanchored: [],
  },
  {
    name: 'return of a method in an unannotated literal',
    code: 'const svc = { run() { return { a: 1 }; } };',
    unanchored: [[1, 12], [1, 29]],
  },
  {
    name: 'right side of ?? with an annotated target',
    code: 'declare const m: { a: number } | undefined;\nconst v: { a: number } = m ?? { a: 0 };',
    unanchored: [],
  },
];

ruleTester.run('require-object-literal-anchor', requireObjectLiteralAnchor, {
  valid: [
    {
      name: 'valid: contextual type from variable annotation',
      filename,
      code: `${preamble}
          const u: UserDto = { id: 1, name: 'a' };
        `,
    },
    {
      name: 'valid: contextual type from function parameter',
      filename,
      code: `${preamble}
          take({ id: 1, name: 'a' });
        `,
    },
    {
      name: 'valid: satisfies anchor',
      filename,
      code: `${preamble}
          const u = { id: 1, name: 'a' } satisfies UserDto;
        `,
    },
    {
      name: 'valid: satisfies on short-circuit literal',
      filename,
      code: `${preamble}
          const flag = true;
          const e = flag && ({ id: 1, title: 't' } satisfies EventDto);
        `,
    },
    {
      name: 'valid: as const',
      filename,
      code: `
          const COLOURS = { primary: '#000', secondary: '#fff' } as const;
        `,
    },
    {
      name: 'valid: as const satisfies T',
      filename,
      code: `
          const COLOURS = { primary: '#000', secondary: '#fff' } as const satisfies Record<string, string>;
        `,
    },
    {
      name: 'valid: function return-type provides contextual type',
      filename,
      code: `${preamble}
          function build(): UserDto {
            return { id: 1, name: 'a' };
          }
        `,
    },
    {
      name: 'valid: arg passed to any-typed function still has contextual type (any)',
      filename,
      code: `${preamble}
          takeLoose({ id: 1, name: 'a' });
        `,
    },
    {
      name: 'valid: array of literals contextually typed via annotation',
      filename,
      code: `${preamble}
          const users: UserDto[] = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
        `,
    },
    ...parity
      .filter(({ unanchored }) => unanchored.length === 0)
      .map(({ name, code }) => ({ name: `valid (TypeScript 5.9 parity): ${name}`, filename, code })),
  ],

  invalid: [
    {
      name: 'invalid: untyped const initializer',
      filename,
      code: `
          const cfg = { retries: 3, timeoutMs: 1000 };
        `,
      errors: [{ messageId: 'requireAnchor' }],
    },
    {
      name: 'invalid: short-circuit produces anonymous shape',
      filename,
      code: `${preamble}
          const flag = true;
          const e = flag && ({ id: 1, title: 't' });
        `,
      errors: [{ messageId: 'requireAnchor' }],
    },
    {
      name: 'invalid: arrow return without annotation',
      filename,
      code: `
          const build = () => ({ foo: 1, bar: 'x' });
        `,
      errors: [{ messageId: 'requireAnchor' }],
    },
    {
      name: 'invalid: function return without annotation',
      filename,
      code: `
          function build() {
            return { foo: 1, bar: 'x' };
          }
        `,
      errors: [{ messageId: 'requireAnchor' }],
    },
    {
      name: 'invalid: as T is rejected in favour of satisfies',
      filename,
      code: `${preamble}
          const u = { id: 1, name: 'a' } as UserDto;
        `,
      errors: [{ messageId: 'asInsteadOfSatisfies' }],
    },
    {
      name: 'invalid: as unknown is rejected',
      filename,
      code: `
          const v = { id: 1, name: 'a' } as unknown;
        `,
      errors: [{ messageId: 'asInsteadOfSatisfies' }],
    },
    ...parity
      .filter(({ unanchored }) => unanchored.length > 0)
      .map(({ name, code, unanchored }) => ({
        name: `invalid (TypeScript 5.9 parity): ${name}`,
        filename,
        code,
        errors: unanchored.map(([line, column]) => ({ messageId: 'requireAnchor', line, column })),
      })),
  ],
});
