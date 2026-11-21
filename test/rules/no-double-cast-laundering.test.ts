import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { noDoubleCastLaundering } from '../../src/rules/no-double-cast-laundering.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');
const filename = path.join(fixturesDir, 'no-double-cast-laundering.ts');

const ruleTester = new RuleTester();

ruleTester.run('no-double-cast-laundering', noDoubleCastLaundering, {
  valid: [
    {
      name: 'valid: single cast to T',
      filename,
      code: `
        declare const raw: { id: number };
        interface User { id: number; name: string; }
        const u = raw as User;
      `,
    },
    {
      name: 'valid: as const',
      filename,
      code: `
        const COLOURS = { a: 1, b: 2 } as const;
      `,
    },
    {
      name: 'valid: double cast through a concrete intermediate is not laundering',
      filename,
      code: `
        interface A { id: number; }
        interface B extends A { name: string; }
        declare const a: A;
        const b = a as B as A;
      `,
    },
    {
      name: 'valid: chained satisfies/as const is not a double cast',
      filename,
      code: `
        const v = { a: 1 } as const satisfies Record<string, number>;
      `,
    },
  ],

  invalid: [
    {
      name: 'invalid: as unknown as T',
      filename,
      code: `
        declare const raw: { wholly: 'different' };
        interface User { id: number; }
        const u = raw as unknown as User;
      `,
      errors: [
        { messageId: 'noLaundering', data: { intermediate: 'unknown' } },
      ],
    },
    {
      name: 'invalid: as any as T',
      filename,
      code: `
        declare const raw: { wholly: 'different' };
        interface User { id: number; }
        const u = raw as any as User;
      `,
      errors: [{ messageId: 'noLaundering', data: { intermediate: 'any' } }],
    },
    {
      name: 'invalid: launders a function call result',
      filename,
      code: `
        interface Result { ok: boolean; }
        declare function getSomething(): { other: string };
        const r = getSomething() as unknown as Result;
      `,
      errors: [
        { messageId: 'noLaundering', data: { intermediate: 'unknown' } },
      ],
    },
    {
      name: 'invalid: launders an object literal',
      filename,
      code: `
        interface EventDto { id: number; title: string; }
        const e = ({ wrong: 'shape' } as unknown as EventDto);
      `,
      errors: [
        { messageId: 'noLaundering', data: { intermediate: 'unknown' } },
      ],
    },
  ],
});
