import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { swaggerMatchesReturnType } from '../../src/rules/swagger-matches-return-type.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');

const filename = path.join(fixturesDir, 'swagger-matches-return-type.ts');

const ruleTester = new RuleTester();

const preamble = `
  function Controller(_path?: string): ClassDecorator { return () => {}; }
  function Get(_path?: string): MethodDecorator { return () => {}; }
  function Post(_path?: string): MethodDecorator { return () => {}; }
  function Put(_path?: string): MethodDecorator { return () => {}; }
  function Patch(_path?: string): MethodDecorator { return () => {}; }
  function Delete(_path?: string): MethodDecorator { return () => {}; }
  function ApiOkResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiCreatedResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiAcceptedResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiNoContentResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiDefaultResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiPageResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiNotFoundResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  const HttpStatus = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    NOT_FOUND: 404,
  } as const;
  class FooDto { id!: string; }
  class BarDto { id!: string; }
  class ErrorDto { message!: string; }
  class PageDto<T> { results!: T[]; total!: number; }
`;

ruleTester.run('swagger-matches-return-type', swaggerMatchesReturnType, {
  valid: [
    {
      name: 'valid: single DTO return matches single DTO swagger',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto })
          get(): Promise<FooDto> { return null!; }
        }
      `,
    },
    {
      name: 'valid: array DTO return matches array literal swagger',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: [FooDto] })
          list(): Promise<FooDto[]> { return null!; }
        }
      `,
    },
    {
      name: 'valid: array DTO return matches isArray: true swagger',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto, isArray: true })
          list(): Promise<FooDto[]> { return null!; }
        }
      `,
    },
    {
      name: 'valid: PageDto return matches ApiPageResponse',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiPageResponse({ type: FooDto })
          list(): Promise<PageDto<FooDto>> { return null!; }
        }
      `,
    },
    {
      name: 'valid: PageDto return matches ApiOkResponse with PageDto<X> instantiation',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: PageDto<FooDto> })
          list(): Promise<PageDto<FooDto>> { return null!; }
        }
      `,
    },
    {
      name: 'valid: ApiCreatedResponse matches return type',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post()
          @ApiCreatedResponse({ type: FooDto })
          create(): Promise<FooDto> { return null!; }
        }
      `,
    },
    {
      name: 'valid: non-2xx ApiResponse with different DTO is ignored',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto })
          @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorDto })
          get(): Promise<FooDto> { return null!; }
        }
      `,
    },
    {
      name: 'valid: ApiNotFoundResponse with different DTO is ignored',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto })
          @ApiNotFoundResponse({ type: ErrorDto })
          get(): Promise<FooDto> { return null!; }
        }
      `,
    },
    {
      name: 'valid: endpoint without any swagger decorator is skipped',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          get(): Promise<FooDto> { return null!; }
        }
      `,
    },
    {
      name: 'valid: endpoint without return-type annotation is skipped',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto })
          get() { return null!; }
        }
      `,
    },
    {
      name: 'valid: ApiResponse with numeric literal 200 matches return',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiResponse({ status: 200, type: FooDto })
          get(): Promise<FooDto> { return null!; }
        }
      `,
    },
    {
      name: 'valid: nullable return strips null and matches single',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto })
          get(): Promise<FooDto | null> { return null!; }
        }
      `,
    },
    {
      name: 'valid: decorator without type: arg (schema-only) is skipped',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ description: 'no type' })
          get(): Promise<FooDto> { return null!; }
        }
      `,
    },
    {
      // The decorator names the class through a renamed import: the rule must compare the
      // class it resolves to, not the local name.
      name: 'valid: a renamed import in the decorator resolves to the class the return type names',
      filename,
      code: `
        import { InjectedService, InjectedService as InjectedAliasService } from './shared/injected.service.js';
        function Controller(_path?: string): ClassDecorator { return () => {}; }
        function Get(_path?: string): MethodDecorator { return () => {}; }
        function ApiOkResponse(_opts?: unknown): MethodDecorator { return () => {}; }
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: InjectedAliasService })
          get(): Promise<InjectedService> { return null!; }
        }
      `,
      options: [{ suffixes: ['Service'] }],
    },
  ],

  invalid: [
    {
      name: 'invalid: single DTO return drifts from swagger DTO',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: BarDto })
          get(): Promise<FooDto> { return null!; }
        }
      `,
      errors: [{ messageId: 'slotMismatch' }],
    },
    {
      name: 'invalid: array return but single swagger',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto })
          list(): Promise<FooDto[]> { return null!; }
        }
      `,
      errors: [{ messageId: 'slotMismatch' }],
    },
    {
      name: 'invalid: single return but ApiPageResponse wrapper',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiPageResponse({ type: FooDto })
          get(): Promise<FooDto> { return null!; }
        }
      `,
      errors: [{ messageId: 'slotMismatch' }],
    },
    {
      name: 'invalid: PageDto return but single swagger',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: FooDto })
          list(): Promise<PageDto<FooDto>> { return null!; }
        }
      `,
      errors: [{ messageId: 'slotMismatch' }],
    },
    {
      name: 'invalid: ApiResponse with HttpStatus.OK and wrong DTO',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiResponse({ status: HttpStatus.OK, type: BarDto })
          get(): Promise<FooDto> { return null!; }
        }
      `,
      errors: [{ messageId: 'slotMismatch' }],
    },
    {
      name: 'invalid: PageDto<X> instantiation in the decorator drifts from the PageDto return',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: PageDto<BarDto> })
          list(): Promise<PageDto<FooDto>> { return null!; }
        }
      `,
      errors: [
        {
          messageId: 'slotMismatch',
          data: { swaggerShape: 'Page<BarDto>', returnShape: 'Page<FooDto>' },
        },
      ],
    },
    {
      // A bare class reference as the return type spans only the class name, where tsrs
      // answers `any` for the Identifier: the rule must get the TypeReference's type.
      name: 'invalid: bare DTO return type drifts from swagger DTO',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiOkResponse({ type: BarDto })
          get(): FooDto { return null!; }
        }
      `,
      errors: [
        {
          messageId: 'slotMismatch',
          data: { swaggerShape: 'BarDto', returnShape: 'FooDto' },
        },
      ],
    },
  ],
});
