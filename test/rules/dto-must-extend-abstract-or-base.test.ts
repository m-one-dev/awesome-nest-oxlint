import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { dtoMustExtendAbstractOrBase } from '../../src/rules/dto-must-extend-abstract-or-base.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');

const filename = path.join(fixturesDir, 'dto-must-extend-abstract-or-base.ts');

const ruleTester = new RuleTester();

const preamble = `
  abstract class TranslatableDto {}
  abstract class BaseDto {}
  abstract class AbstractDto extends TranslatableDto {}
  abstract class AbstractTranslationDto extends AbstractDto {}
  class SomeOther {}
  function PickType<T>(cls: T, keys: string[]): any { return class {}; }
  class CreateFooDto extends BaseDto {}
`;

ruleTester.run(
  'dto-must-extend-abstract-or-base',
  dtoMustExtendAbstractOrBase,
  {
    valid: [
      {
        name: 'valid: direct BaseDto extension',
        filename,
        code: `${preamble}
        class FooDto extends BaseDto {}
      `,
      },
      {
        name: 'valid: direct AbstractDto extension',
        filename,
        code: `${preamble}
        class FooDto extends AbstractDto {}
      `,
      },
      {
        name: 'valid: transitive extension through another Dto',
        filename,
        code: `${preamble}
        class BarDto extends BaseDto {}
        class FooDto extends BarDto {}
      `,
      },
      {
        name: 'valid: generic class extending BaseDto',
        filename,
        code: `${preamble}
        class FooDto<T> extends BaseDto {
          value!: T;
        }
      `,
      },
      {
        name: 'valid: class extending generic base reference',
        filename,
        code: `${preamble}
        class GenericBaseDto<T> extends BaseDto { v!: T; }
        class FooDto extends GenericBaseDto<string> {}
      `,
      },
      {
        name: 'valid: AbstractDto itself is allowlisted',
        filename,
        code: `
        abstract class TranslatableDto {}
        abstract class AbstractDto extends TranslatableDto {}
      `,
      },
      {
        name: 'valid: BaseDto itself is allowlisted',
        filename,
        code: `
        abstract class BaseDto {}
      `,
      },
      {
        name: 'valid: TranslatableDto itself is allowlisted',
        filename,
        code: `
        abstract class TranslatableDto {}
      `,
      },
      {
        name: 'valid: AbstractTranslationDto itself is allowlisted',
        filename,
        code: `${preamble}
        // AbstractTranslationDto is in preamble already; re-assert via a nested reference
        class ShouldNotTriggerDto extends AbstractTranslationDto {}
      `,
      },
      {
        name: 'valid: ClassExpression assigned to const, extends BaseDto',
        filename,
        code: `${preamble}
        const FooDto = class FooDto extends BaseDto {};
      `,
      },
      {
        name: 'valid: base reached through a dotted superclass',
        filename,
        code: `${preamble}
        namespace dtos { export abstract class BaseDto {} }
        class FooDto extends dtos.BaseDto {}
      `,
      },
      {
        name: 'valid: base reached through an import alias',
        filename,
        code: `${preamble}
        namespace dtos { export abstract class AbstractDto {} }
        import Base = dtos.AbstractDto;
        class FooDto extends Base {}
      `,
      },
      {
        name: 'valid: class not ending in Dto is ignored',
        filename,
        code: `${preamble}
        class FooBar {}
        class FooService {}
      `,
      },
      {
        name: 'valid: FooController ignored',
        filename,
        code: `${preamble}
        class FooController {}
      `,
      },
    ],

    invalid: [
      {
        name: 'invalid: class ending Dto with no superclass',
        filename,
        code: `${preamble}
        class FooDto {}
      `,
        errors: [{ messageId: 'mustExtend', data: { name: 'FooDto' } }],
      },
      {
        name: 'invalid: class ending Dto extending unrelated class',
        filename,
        code: `${preamble}
        class FooDto extends SomeOther {}
      `,
        errors: [{ messageId: 'mustExtend', data: { name: 'FooDto' } }],
      },
      {
        name: 'invalid: transitive chain that never reaches Base/Abstract',
        filename,
        code: `${preamble}
        class BarDto {}
        class FooDto extends BarDto {}
      `,
        errors: [
          { messageId: 'mustExtend', data: { name: 'BarDto' } },
          { messageId: 'mustExtend', data: { name: 'FooDto' } },
        ],
      },
      {
        name: 'invalid: CallExpression superclass (e.g. mapped-type helpers) is not resolved; known limitation — not currently used in this codebase',
        filename,
        code: `${preamble}
        class FooDto extends PickType(CreateFooDto, ['x']) {}
      `,
        errors: [{ messageId: 'mustExtend', data: { name: 'FooDto' } }],
      },
      {
        name: 'invalid: ClassExpression not extending base',
        filename,
        code: `${preamble}
        const FooDto = class FooDto extends SomeOther {};
      `,
        errors: [{ messageId: 'mustExtend', data: { name: 'FooDto' } }],
      },
    ],
  },
);
