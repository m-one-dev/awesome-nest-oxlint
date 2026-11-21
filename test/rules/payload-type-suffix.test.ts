import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { payloadTypeSuffix } from '../../src/rules/payload-type-suffix.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');

const filename = path.join(fixturesDir, 'payload-type-suffix.ts');

const ruleTester = new RuleTester();

const preamble = `
  class AbstractClientService<A> {
    protected send<R>(pattern: A, data: unknown, opts?: unknown): Promise<R> { return null as any; }
    protected emit<I>(pattern: A, data: I): void {}
  }
  class IntermediateClientService<A> extends AbstractClientService<A> {}
  function Payload(): ParameterDecorator { return () => {}; }
  enum Action { CREATE = 'create', UPDATE = 'update' }
  class CreateFooPayloadDto { a!: string; }
  class UpdateFooPayloadDto { b!: string; }
  class FooPageOptionsDto { limit!: number; }
  class FooCursorPageOptionsDto { cursor!: string; }
  class FooResponseDto { id!: string; }
  class CreateFooDto { a!: string; }
  class BarDto { x!: number; }
`;

ruleTester.run('payload-type-suffix', payloadTypeSuffix, {
  valid: [
    {
      name: 'valid @Payload() with PayloadDto suffix',
      filename,
      code: `${preamble}
        class FooController {
          create(@Payload() payload: CreateFooPayloadDto) { return payload; }
        }
      `,
    },
    {
      name: 'valid @Payload() with PageOptionsDto suffix',
      filename,
      code: `${preamble}
        class FooController {
          list(@Payload() opts: FooPageOptionsDto) { return opts; }
        }
      `,
    },
    {
      name: 'valid @Payload() with CursorPageOptionsDto suffix',
      filename,
      code: `${preamble}
        class FooController {
          list(@Payload() opts: FooCursorPageOptionsDto) { return opts; }
        }
      `,
    },
    {
      name: 'valid send() with typed PayloadDto arg',
      filename,
      code: `${preamble}
        class FooClient extends AbstractClientService<Action> {
          create(payload: CreateFooPayloadDto) { return this.send<FooResponseDto>(Action.CREATE, payload); }
        }
      `,
    },
    {
      name: 'valid send() with inline object literal is ignored',
      filename,
      code: `${preamble}
        class FooClient extends AbstractClientService<Action> {
          create() { return this.send<FooResponseDto>(Action.CREATE, { inline: 'obj' }); }
        }
      `,
    },
    {
      name: 'valid emit() is checked the same as send()',
      filename,
      code: `${preamble}
        class FooClient extends AbstractClientService<Action> {
          touch(payload: CreateFooPayloadDto) { this.emit(Action.UPDATE, payload); }
        }
      `,
    },
    {
      name: 'valid @Payload() with PayloadDto[] array',
      filename,
      code: `${preamble}
        class FooController {
          bulk(@Payload() items: CreateFooPayloadDto[]) { return items; }
        }
      `,
    },
    {
      name: 'valid @Payload() with Partial<PayloadDto>',
      filename,
      code: `${preamble}
        class FooController {
          patch(@Payload() payload: Partial<CreateFooPayloadDto>) { return payload; }
        }
      `,
    },
    {
      name: 'valid @Payload() with union of payload types',
      filename,
      code: `${preamble}
        class FooController {
          upsert(@Payload() payload: CreateFooPayloadDto | UpdateFooPayloadDto) { return payload; }
        }
      `,
    },
    {
      name: 'valid: class not extending AbstractClientService is ignored',
      filename,
      code: `${preamble}
        class UnrelatedService {
          send(x: string, y: CreateFooDto) { return y; }
          doit(payload: CreateFooDto) { return this.send('x', payload); }
        }
      `,
    },
    {
      name: 'valid: class whose base chain never reaches AbstractClientService is ignored',
      filename,
      code: `${preamble}
        class OtherSender { protected send(x: string, y: unknown) { return y; } }
        class OtherClient extends OtherSender {
          doit(payload: CreateFooDto) { return this.send('x', payload); }
        }
      `,
    },
    {
      name: 'valid: param name check off by default',
      filename,
      code: `${preamble}
        class FooController {
          create(@Payload() createFooDto: CreateFooPayloadDto) { return createFooDto; }
        }
      `,
    },
    {
      name: 'valid @Payload() with an inline object type is not named',
      filename,
      code: `${preamble}
        class FooController {
          create(@Payload() payload: { a: string }) { return payload; }
        }
      `,
    },
    {
      name: 'valid send() with an object-literal-typed variable is not named',
      filename,
      code: `${preamble}
        class FooClient extends AbstractClientService<Action> {
          create() { const data = { a: 'x' }; return this.send<FooResponseDto>(Action.CREATE, data); }
        }
      `,
    },
    {
      name: 'valid: multi-level inheritance with compliant payload',
      filename,
      code: `${preamble}
        class FooClient extends IntermediateClientService<Action> {
          create(payload: CreateFooPayloadDto) { return this.send<FooResponseDto>(Action.CREATE, payload); }
        }
      `,
    },
  ],

  invalid: [
    {
      name: '@Payload() with non-PayloadDto type',
      filename,
      code: `${preamble}
        class FooController {
          create(@Payload() payload: CreateFooDto) { return payload; }
        }
      `,
      errors: [{ messageId: 'payloadTypeSuffix' }],
    },
    {
      name: '@Payload() with no type annotation',
      filename,
      code: `${preamble}
        class FooController {
          create(@Payload() payload) { return payload; }
        }
      `,
      errors: [{ messageId: 'missingType' }],
    },
    {
      name: 'send() arg typed as non-PayloadDto inside AbstractClientService subclass',
      filename,
      code: `${preamble}
        class FooClient extends AbstractClientService<Action> {
          create(payload: CreateFooDto) { return this.send<FooResponseDto>(Action.CREATE, payload); }
        }
      `,
      errors: [{ messageId: 'sendArgTypeSuffix' }],
    },
    {
      name: 'send() arg typed as union with one non-compliant member',
      filename,
      code: `${preamble}
        class FooClient extends AbstractClientService<Action> {
          create(payload: CreateFooPayloadDto | BarDto) { return this.send<FooResponseDto>(Action.CREATE, payload); }
        }
      `,
      errors: [{ messageId: 'sendArgTypeSuffix' }],
    },
    {
      name: '@Payload() with array of non-PayloadDto',
      filename,
      code: `${preamble}
        class FooController {
          bulk(@Payload() items: CreateFooDto[]) { return items; }
        }
      `,
      errors: [{ messageId: 'payloadTypeSuffix' }],
    },
    {
      name: 'multi-level inheritance still triggers send() check',
      filename,
      code: `${preamble}
        class FooClient extends IntermediateClientService<Action> {
          create(payload: CreateFooDto) { return this.send<FooResponseDto>(Action.CREATE, payload); }
        }
      `,
      errors: [{ messageId: 'sendArgTypeSuffix' }],
    },
    {
      name: '@Payload() with a qualified non-PayloadDto type',
      filename,
      code: `${preamble}
        namespace foo { export class CreateDto { a!: string; } }
        class FooController {
          create(@Payload() payload: foo.CreateDto) { return payload; }
        }
      `,
      errors: [{ messageId: 'payloadTypeSuffix', data: { name: 'CreateDto', suffixes: 'PayloadDto, PageOptionsDto, CursorPageOptionsDto' } }],
    },
    {
      name: 'send() check reaches AbstractClientService through two generic intermediates',
      filename,
      code: `${preamble}
        class DeeperClientService<A> extends IntermediateClientService<A> {}
        class FooClient extends DeeperClientService<Action> {
          create(payload: CreateFooDto) { return this.send<FooResponseDto>(Action.CREATE, payload); }
        }
      `,
      errors: [{ messageId: 'sendArgTypeSuffix', data: { method: 'send', name: 'CreateFooDto', suffixes: 'PayloadDto, PageOptionsDto, CursorPageOptionsDto' } }],
    },
    {
      name: 'enforcePayloadParamName: flags non-"payload" identifier',
      filename,
      code: `${preamble}
        class FooController {
          create(@Payload() createFooDto: CreateFooPayloadDto) { return createFooDto; }
        }
      `,
      options: [{ enforcePayloadParamName: true }],
      errors: [{ messageId: 'paramNameMustBePayload' }],
    },
    {
      name: 'custom allowedSuffixes respected',
      filename,
      code: `${preamble}
        class FooController {
          create(@Payload() payload: CreateFooPayloadDto) { return payload; }
        }
      `,
      options: [{ allowedSuffixes: ['Message'] }],
      errors: [{ messageId: 'payloadTypeSuffix' }],
    },
  ],
});
