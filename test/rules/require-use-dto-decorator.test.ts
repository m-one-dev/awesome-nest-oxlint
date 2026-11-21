import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { requireUseDtoDecorator } from '../../src/rules/require-use-dto-decorator.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');

const filename = path.join(fixturesDir, 'require-use-dto-decorator.ts');

const ruleTester = new RuleTester();

const preamble = `
  abstract class AbstractEntity {}
  abstract class AbstractTranslationEntity extends AbstractEntity {}
  declare function UseDto(cls: any): ClassDecorator;
`;

ruleTester.run('require-use-dto-decorator', requireUseDtoDecorator, {
  valid: [
    {
      name: 'valid: entity with @UseDto decorator',
      filename,
      code: `${preamble}
        class UserDto {}
        @UseDto(UserDto)
        class UserEntity extends AbstractEntity {}
      `,
    },
    {
      name: 'valid: AbstractEntity itself is allowlisted',
      filename,
      code: `
        abstract class AbstractEntity {}
      `,
    },
    {
      name: 'valid: AbstractTranslationEntity itself is allowlisted',
      filename,
      code: `
        abstract class AbstractEntity {}
        abstract class AbstractTranslationEntity extends AbstractEntity {}
      `,
    },
    {
      name: 'valid: abstract concrete-named entity is skipped',
      filename,
      code: `${preamble}
        abstract class BaseUserEntity extends AbstractEntity {}
      `,
    },
    {
      name: 'valid: class not extending AbstractEntity',
      filename,
      code: `${preamble}
        class SomethingService {}
        class UnrelatedEntity {}
      `,
    },
    {
      name: 'valid: transitive @UseDto via inheritance is irrelevant — direct decorator required, but transitive AbstractEntity inheritance with own decorator is fine',
      filename,
      code: `${preamble}
        class FooDto {}
        @UseDto(FooDto)
        class FooEntity extends AbstractTranslationEntity {}
      `,
    },
  ],

  invalid: [
    {
      name: 'invalid: missing @UseDto on entity → autofix derives UserDto from UserEntity',
      filename,
      code: `${preamble}
        class UserEntity extends AbstractEntity {}
      `,
      errors: [
        {
          messageId: 'missingUseDto',
          data: { name: 'UserEntity', dto: 'UserDto' },
        },
      ],
      output: `${preamble}
        @UseDto(UserDto)
        class UserEntity extends AbstractEntity {}
      `,
    },
    {
      name: 'invalid: missing @UseDto on transitive entity → autofix derives SkillTranslationDto',
      filename,
      code: `${preamble}
        class SkillTranslationEntity extends AbstractTranslationEntity {}
      `,
      errors: [
        {
          messageId: 'missingUseDto',
          data: {
            name: 'SkillTranslationEntity',
            filename,
            dto: 'SkillTranslationDto',
          },
        },
      ],
      output: `${preamble}
        @UseDto(SkillTranslationDto)
        class SkillTranslationEntity extends AbstractTranslationEntity {}
      `,
    },
    {
      name: 'invalid: missing @UseDto on entity-without-Entity-suffix → derives FooDto',
      filename,
      code: `${preamble}
        class Foo extends AbstractEntity {}
      `,
      errors: [
        { messageId: 'missingUseDto', data: { name: 'Foo', dto: 'FooDto' } },
      ],
      output: `${preamble}
        @UseDto(FooDto)
        class Foo extends AbstractEntity {}
      `,
    },
    {
      name: 'invalid: entity reaching AbstractEntity through an import alias',
      filename,
      code: `${preamble}
        namespace entities { export abstract class AbstractEntity {} }
        import Base = entities.AbstractEntity;
        class UserEntity extends Base {}
      `,
      errors: [
        {
          messageId: 'missingUseDto',
          data: { name: 'UserEntity', dto: 'UserDto' },
        },
      ],
      output: `${preamble}
        namespace entities { export abstract class AbstractEntity {} }
        import Base = entities.AbstractEntity;
        @UseDto(UserDto)
        class UserEntity extends Base {}
      `,
    },
    {
      name: 'invalid: entity with non-UseDto decorators → inserts before existing decorators',
      filename,
      code: `${preamble}
        declare function Entity(): ClassDecorator;
        @Entity()
        class UserEntity extends AbstractEntity {}
      `,
      errors: [
        {
          messageId: 'missingUseDto',
          data: { name: 'UserEntity', dto: 'UserDto' },
        },
      ],
      output: `${preamble}
        declare function Entity(): ClassDecorator;
        @UseDto(UserDto)
        @Entity()
        class UserEntity extends AbstractEntity {}
      `,
    },
  ],
});
