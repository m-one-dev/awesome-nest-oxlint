import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { uniqueEndpointDtos } from '../../src/rules/unique-endpoint-dtos.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');

const filename = path.join(fixturesDir, 'unique-endpoint-dtos.ts');

const ruleTester = new RuleTester();

const preamble = `
  function Controller(_path?: string): ClassDecorator { return () => {}; }
  function Get(_path?: string): MethodDecorator { return () => {}; }
  function Post(_path?: string): MethodDecorator { return () => {}; }
  function Put(_path?: string): MethodDecorator { return () => {}; }
  function Patch(_path?: string): MethodDecorator { return () => {}; }
  function Delete(_path?: string): MethodDecorator { return () => {}; }
  function Body(_field?: string): ParameterDecorator { return () => {}; }
  function Query(_field?: string): ParameterDecorator { return () => {}; }
  function ApiOkResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiCreatedResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  function ApiPageResponse(_opts?: unknown): MethodDecorator { return () => {}; }
  class PageDto<T> { results!: T[]; }
  class CreateFooDto { a!: string; }
  class UpdateFooDto { b!: string; }
  class FooQueryDto { q!: string; }
  class BarQueryDto { q!: string; }
  class FooResponseDto { id!: string; }
  class ListFooResponseDto { items!: string[]; }
  class CreateBarDto { a!: string; }
  class BarResponseDto { id!: string; }
  class FooSchema { a!: string; }
  class BarSchema { b!: string; }
`;

/** Where `needle` starts in `code`: line 1-based, column 0-based, as a usage's location records it. */
function positionOf(code: string, needle: string): { line: number; column: number } {
  const before = code.slice(0, code.indexOf(needle)).split('\n');

  return { line: before.length, column: before.at(-1)!.length };
}

// Usages are recorded at Program:exit, in the order the visitor met them: an endpoint's
// @Body() comes before its Swagger response type, so the response is the one reported.
const bodyThenSwaggerCode = `${preamble}
        @Controller('foo')
        class FooController {
          @Post()
          @ApiOkResponse({ type: CreateFooDto })
          create(@Body() dto: CreateFooDto) { return null!; }
        }
      `;
const bodyAt = positionOf(bodyThenSwaggerCode, 'CreateFooDto) {');
const swaggerAt = positionOf(bodyThenSwaggerCode, 'CreateFooDto })');

ruleTester.run('unique-endpoint-dtos', uniqueEndpointDtos, {
  valid: [
    {
      name: 'valid: different DTOs in each slot',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }
          @Get()  list(@Query() q: FooQueryDto): ListFooResponseDto { return null!; }
          @Put()  update(@Body() dto: UpdateFooDto): BarResponseDto { return null!; }
        }
      `,
    },
    {
      name: 'valid: same DTO reused inside non-endpoint helper method is ignored',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }
          private helper(dto: CreateFooDto): CreateFooDto { return dto; }
        }
      `,
    },
    {
      name: 'valid: @Body("field") with primitive type is ignored',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body('id') id: string, @Body() dto: CreateFooDto): FooResponseDto { return null!; }
        }
      `,
    },
    {
      name: 'valid: class without @Controller is ignored',
      filename,
      code: `${preamble}
        class FooService {
          create(dto: CreateFooDto): CreateFooDto { return dto; }
          update(dto: CreateFooDto): CreateFooDto { return dto; }
        }
      `,
    },
    {
      name: 'valid: types not ending in Dto are ignored by default',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() x: FooSchema): BarSchema { return null!; }
          @Put()  update(@Body() y: FooSchema): BarSchema { return null!; }
        }
      `,
    },
    {
      name: 'valid: Promise<Dto> and Dto[] unwrap and remain unique',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): Promise<FooResponseDto> { return null!; }
          @Get()  list(@Query() q: FooQueryDto): ListFooResponseDto[] { return []; }
        }
      `,
    },
    {
      name: 'valid: custom suffixes — *Schema matched, all unique',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() x: FooSchema): BarSchema { return null!; }
        }
      `,
      options: [{ suffixes: ['Schema'] }],
    },
    {
      name: 'valid: @ApiOkResponse type that is unique across endpoints',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post()
          @ApiCreatedResponse({ type: FooResponseDto })
          create(@Body() dto: CreateFooDto) { return null!; }

          @Get()
          @ApiOkResponse({ type: ListFooResponseDto })
          list(@Query() q: FooQueryDto) { return null!; }
        }
      `,
    },
    {
      name: 'valid: same DTO on return type and @ApiResponse type of the same endpoint occupies one response slot',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiResponse({ status: 200, description: 'ok', type: FooResponseDto })
          fetch(): Promise<FooResponseDto> { return null!; }
        }
      `,
    },
    {
      name: 'valid: same DTO on PageDto return type and @ApiPageResponse type of the same endpoint occupies one response slot',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get()
          @ApiPageResponse({ type: FooResponseDto })
          list(): Promise<PageDto<FooResponseDto>> { return null!; }
        }
      `,
    },
  ],

  invalid: [
    {
      name: 'invalid: same DTO used as @Body in two endpoints',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }
          @Put()  update(@Body() dto: CreateFooDto): BarResponseDto { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: same DTO used as @Body and @Query',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: FooQueryDto): FooResponseDto { return null!; }
          @Get()  list(@Query() q: FooQueryDto): ListFooResponseDto { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: same DTO used as @Body and as response',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }
          @Get()  fetch(): CreateFooDto { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: same DTO inside Promise<> as response duplicates @Body',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }
          @Get()  fetch(): Promise<CreateFooDto> { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: array return type duplicates a @Body DTO',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }
          @Get()  list(): CreateFooDto[] { return []; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: same DTO across two different controllers in one file',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }
        }
        @Controller('bar')
        class BarController {
          @Post() create(@Body() dto: CreateFooDto): BarResponseDto { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: @ApiOkResponse type duplicates a @Body DTO',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post()
          create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }

          @Get()
          @ApiOkResponse({ type: CreateFooDto })
          fetch() { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: @ApiOkResponse with type as array literal',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post()
          create(@Body() dto: CreateFooDto): FooResponseDto { return null!; }

          @Get()
          @ApiOkResponse({ type: [CreateFooDto] })
          list() { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: response type duplicated across two endpoints',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Get('a') one(): FooResponseDto { return null!; }
          @Get('b') two(): FooResponseDto { return null!; }
        }
      `,
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: custom suffixes — *Schema duplicate caught',
      filename,
      code: `${preamble}
        @Controller('foo')
        class FooController {
          @Post() create(@Body() x: FooSchema): BarSchema { return null!; }
          @Put()  update(@Body() y: FooSchema): CreateFooDto { return null!; }
        }
      `,
      options: [{ suffixes: ['Schema'] }],
      errors: [{ messageId: 'duplicateDto' }],
    },
    {
      name: 'invalid: within one endpoint, the @Body is recorded before the Swagger response type',
      filename,
      code: bodyThenSwaggerCode,
      errors: [
        {
          messageId: 'duplicateDto',
          data: {
            name: 'CreateFooDto',
            prevPosition: 'body',
            prevController: 'FooController',
            prevMethod: 'create',
            prevLocation: `${filename}:${bodyAt.line}:${bodyAt.column}`,
          },
          line: swaggerAt.line,
          column: swaggerAt.column,
          endLine: swaggerAt.line,
          endColumn: swaggerAt.column + 'CreateFooDto'.length,
        },
      ],
    },
    {
      // An imported class reaches the decorator as an import alias, and the parameter as the
      // class type; both must resolve to the class declared in the other file.
      name: 'invalid: a class imported from another file is the same DTO in a decorator and a parameter',
      filename,
      code: `
        import { InjectedService } from './shared/injected.service.js';
        function Controller(_path?: string): ClassDecorator { return () => {}; }
        function Get(_path?: string): MethodDecorator { return () => {}; }
        function Post(_path?: string): MethodDecorator { return () => {}; }
        function Body(_field?: string): ParameterDecorator { return () => {}; }
        function ApiOkResponse(_opts?: unknown): MethodDecorator { return () => {}; }
        @Controller('foo')
        class FooController {
          @Post() create(@Body() dto: InjectedService): void {}
          @Get()
          @ApiOkResponse({ type: InjectedService })
          fetch() { return null!; }
        }
      `,
      options: [{ suffixes: ['Service'] }],
      errors: [{ messageId: 'duplicateDto' }],
    },
  ],
});

// --- Duplicates across files ---------------------------------------------------
// A DTO's owner is its first usage by file path, then by order within the file. The
// files below are on disk, and each case lints a file's on-disk text, so every case
// sees the same program whichever file is linted first.

const crossFileDir = path.join(fixturesDir, 'unique-endpoint-dtos');
const alphaFilename = path.join(crossFileDir, 'alpha.controller.ts');
const betaFilename = path.join(crossFileDir, 'beta.controller.ts');
const alphaCode = readFileSync(alphaFilename, 'utf8');
const betaCode = readFileSync(betaFilename, 'utf8');
const ownerAt = positionOf(alphaCode, 'SharedPayloadDto): void');
const betaBodyAt = positionOf(betaCode, 'SharedPayloadDto): void');
const betaSwaggerAt = positionOf(betaCode, 'SharedPayloadDto })');

const ownedByAlpha = {
  messageId: 'duplicateDto',
  data: {
    name: 'SharedPayloadDto',
    prevPosition: 'body',
    prevController: 'AlphaController',
    prevMethod: 'create',
    prevLocation: `${alphaFilename}:${ownerAt.line}:${ownerAt.column}`,
  },
};

const ownerCase = {
  name: 'valid: the file whose path sorts first owns the DTO, though a later file uses it too',
  filename: alphaFilename,
  code: alphaCode,
};

const duplicateCase = {
  name: 'invalid: a file reports its usages of a DTO an earlier file owns',
  filename: betaFilename,
  code: betaCode,
  errors: [
    {
      ...ownedByAlpha,
      line: betaBodyAt.line,
      column: betaBodyAt.column,
      endLine: betaBodyAt.line,
      endColumn: betaBodyAt.column + 'SharedPayloadDto'.length,
    },
    {
      ...ownedByAlpha,
      line: betaSwaggerAt.line,
      column: betaSwaggerAt.column,
      endLine: betaSwaggerAt.line,
      endColumn: betaSwaggerAt.column + 'SharedPayloadDto'.length,
    },
  ],
};

// Owner linted first, then the duplicate.
ruleTester.run('unique-endpoint-dtos across files, owner linted first', uniqueEndpointDtos, {
  valid: [ownerCase],
  invalid: [duplicateCase],
});

// Duplicate linted first, then the owner.
ruleTester.run('unique-endpoint-dtos across files, duplicate linted first', uniqueEndpointDtos, {
  valid: [],
  invalid: [duplicateCase],
});
ruleTester.run('unique-endpoint-dtos across files, owner linted last', uniqueEndpointDtos, {
  valid: [ownerCase],
  invalid: [],
});
