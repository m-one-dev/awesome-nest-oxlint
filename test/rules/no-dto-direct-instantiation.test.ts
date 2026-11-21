import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { noDtoDirectInstantiation } from '../../src/rules/no-dto-direct-instantiation.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');
const filename = path.join(fixturesDir, 'no-dto-direct-instantiation.ts');

const ruleTester = new RuleTester();

ruleTester.run('no-dto-direct-instantiation', noDtoDirectInstantiation, {
  valid: [
    {
      name: 'valid: SomeDto.create(...) call',
      filename,
      code: `
        declare const SomeDto: { create: (data: any) => any };
        const dto = SomeDto.create({ foo: 'bar' });
      `,
    },
    {
      name: 'valid: entity.toDto() call',
      filename,
      code: `
        declare const entity: { toDto: () => any };
        const dto = entity.toDto();
      `,
    },
    {
      name: 'valid: entities.toDtos() call',
      filename,
      code: `
        declare const entities: { toDtos: () => any[] };
        const dtos = entities.toDtos();
      `,
    },
    {
      name: 'valid: new on a class not ending in Dto',
      filename,
      code: `
        class Foo {}
        const f = new Foo();
      `,
    },
    {
      name: 'valid: new SomeDto(...) inside its own static create method',
      filename,
      code: `
        class FooDto {
          static create(data: { x: number }): FooDto {
            return new FooDto();
          }
        }
      `,
    },
    {
      name: 'valid: plainToInstance with non-Dto target',
      filename,
      code: `
        declare function plainToInstance<T>(cls: any, data: any): T;
        class Foo {}
        const r = plainToInstance(Foo, { x: 1 });
      `,
    },
    {
      name: 'valid: plainToInstance(this, data) inside BaseDto.create',
      filename,
      code: `
        declare function plainToInstance<T>(cls: any, data: any): T;
        class BaseDto {
          static create<T extends BaseDto>(this: new (...args: any[]) => T, data: any): T {
            return plainToInstance(this, data);
          }
        }
      `,
    },
  ],

  invalid: [
    {
      name: 'invalid: new SomeDto({...}) → autofix to SomeDto.create({...})',
      filename,
      code: `
        class FooDto {}
        const dto = new FooDto({ x: 1 });
      `,
      errors: [
        { messageId: 'noNewWithObjectLiteral', data: { name: 'FooDto' } },
      ],
      output: `
        class FooDto {}
        const dto = FooDto.create({ x: 1 });
      `,
    },
    {
      name: 'invalid: new SomeDto(entity) → no autofix, suggests toDto/create',
      filename,
      code: `
        class FooDto {}
        declare const entity: any;
        const dto = new FooDto(entity);
      `,
      errors: [{ messageId: 'noNewWithEntity', data: { name: 'FooDto' } }],
    },
    {
      name: 'invalid: new SomeDto() with no args → no autofix',
      filename,
      code: `
        class FooDto {}
        const dto = new FooDto();
      `,
      errors: [{ messageId: 'noNewWithEntity', data: { name: 'FooDto' } }],
    },
    {
      name: 'invalid: plainToInstance(SomeDto, data) → autofix to SomeDto.create(data)',
      filename,
      code: `
        declare function plainToInstance<T>(cls: any, data: any): T;
        class FooDto {}
        declare const data: any;
        const r = plainToInstance(FooDto, data);
      `,
      errors: [{ messageId: 'noPlainToInstance', data: { name: 'FooDto' } }],
      output: `
        declare function plainToInstance<T>(cls: any, data: any): T;
        class FooDto {}
        declare const data: any;
        const r = FooDto.create(data);
      `,
    },
    {
      name: 'invalid: UtilsProvider.plainToInstance(SomeDto, data) → autofix',
      filename,
      code: `
        const UtilsProvider = { plainToInstance<T>(cls: any, data: any): T { return data; } };
        class FooDto {}
        declare const data: any;
        const r = UtilsProvider.plainToInstance(FooDto, data);
      `,
      errors: [{ messageId: 'noPlainToInstance', data: { name: 'FooDto' } }],
      output: `
        const UtilsProvider = { plainToInstance<T>(cls: any, data: any): T { return data; } };
        class FooDto {}
        declare const data: any;
        const r = FooDto.create(data);
      `,
    },
    {
      name: 'invalid: plainToInstance(SomeDto, data, options) → no autofix (3rd arg present)',
      filename,
      code: `
        declare function plainToInstance<T>(cls: any, data: any, options?: any): T;
        class FooDto {}
        declare const data: any;
        const r = plainToInstance(FooDto, data, { groups: ['ALL'] });
      `,
      errors: [{ messageId: 'noPlainToInstance', data: { name: 'FooDto' } }],
    },
    {
      name: 'invalid: new SomeDto(...) inside a different class static create',
      filename,
      code: `
        class BarDto {}
        class FooDto {
          static create(): FooDto {
            return new BarDto({ y: 2 }) as any;
          }
        }
      `,
      errors: [
        { messageId: 'noNewWithObjectLiteral', data: { name: 'BarDto' } },
      ],
      output: `
        class BarDto {}
        class FooDto {
          static create(): FooDto {
            return BarDto.create({ y: 2 }) as any;
          }
        }
      `,
    },
  ],
});
