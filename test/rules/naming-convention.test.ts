import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';
import { describe, expect, it } from 'vitest';

import { namingConvention } from '../../src/rules/naming-convention.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');
const filename = path.join(fixturesDir, 'naming-convention.ts');

const ruleTester = new RuleTester();

// The options .oxlintrc.json gives the rule, carried over from eslint.config.ts's @typescript-eslint/naming-convention.
const WORKSPACE_OPTIONS = [
  {
    selector: 'default',
    format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'],

    filter: {
      regex: '^_.*$',
      match: false,
    },
  },
  {
    selector: 'variable',
    format: ['camelCase', 'UPPER_CASE'],
  },
  {
    selector: 'interface',
    format: ['PascalCase'],
  },
  {
    selector: 'typeLike',
    format: ['PascalCase'],
  },
  {
    selector: 'memberLike',
    modifiers: ['private'],
    format: ['camelCase'],
    leadingUnderscore: 'forbid',
  },
  {
    selector: 'variable',
    types: ['boolean'],
    format: ['PascalCase'],
    prefix: ['is', 'should', 'has', 'can', 'show', 'hide', 'did', 'will', 'include', 'includes'],
  },
];

const ANY_FORMAT = 'camelCase, PascalCase, snake_case, UPPER_CASE';
const VARIABLE_FORMAT = 'camelCase, UPPER_CASE';
const BOOLEAN_PREFIXES = 'is, should, has, can, show, hide, did, will, include, includes';

function badFormat(type: string, name: string, formats: string) {
  return { messageId: 'doesNotMatchFormat', data: { type, name, formats } } as const;
}

function badTrimmedBoolean(name: string, processedName: string) {
  return {
    messageId: 'doesNotMatchFormatTrimmed',
    data: { type: 'Variable', name, processedName, formats: 'PascalCase' },
  } as const;
}

function missingBooleanPrefix(name: string) {
  return {
    messageId: 'missingAffix',
    data: { type: 'Variable', name, position: 'prefix', affixes: BOOLEAN_PREFIXES },
  } as const;
}

function leadingUnderscore(type: string, name: string) {
  return { messageId: 'unexpectedUnderscore', data: { type, name, position: 'leading' } } as const;
}

// ---------------------------------------------------------------------------
// the workspace's configuration
// ---------------------------------------------------------------------------

ruleTester.run('naming-convention: workspace configuration', namingConvention, {
  valid: [
    {
      name: 'default: function, parameter and default-import names in any of the four formats',
      code: `
        import express from 'express';
        import * as lodash_fp from 'lodash/fp';
        import { default as Router } from 'express';
        import { some_named_export, Other_Named } from 'some-module';
        function doThing(user_id: string, UserName: string, MAX: number): void {}
        function do_thing(): void {}
        function DoThing(): void {}
        function DO_THING(): void {}
      `,
    },
    {
      name: 'default: the ^_ filter leaves names with a leading underscore unchecked',
      code: `
        function _helper(_unused: string, __Weird_Name: number): void {}
        const meta = { _id: 1, __v: 0, '_meta-data': 2 };
        class Store {
          protected _cache = 1;
          #_secret = 2;
          _Odd_Name(): void {}
        }
        enum Kind {
          _Hidden_Value,
        }
        interface IThing {
          _Raw_Field: string;
        }
      `,
    },
    {
      name: 'variable: camelCase and UPPER_CASE, declared, destructured and in for-of',
      code: `
        const userLabel = 'a';
        const MAX_RETRIES = 3;
        let count = 0;
        const { firstName, LAST } = { firstName: 'a', LAST: 'b' };
        const [head, ...rest] = [1, 2];
        for (const item of [1, 2]) {}
      `,
    },
    {
      name: 'boolean: each prefix, then PascalCase; an empty rest is PascalCase',
      code: `
        const isReady = true;
        let hasItems: boolean = false;
        declare const shouldRetry: boolean | undefined;
        const canEdit = Math.random() > 0.5;
        const { didLoad } = { didLoad: true };
        const willClose: true | null = null;
        const showBanner = false;
        const hideFooter = true;
        const includeDrafts = false;
        const is = true;
      `,
    },
    {
      name: 'boolean: a variable of any other type needs no prefix',
      code: `
        const label = 'x';
        const flags: boolean[] = [];
        const mixed: boolean | string = 'x';
        const wrapper: Boolean = new Boolean(true);
        const anything: any = true;
        const check = (): boolean => true;
        function generic<T extends boolean>(value: T): T {
          const copy = value;
          return copy;
        }
      `,
    },
    {
      name: 'interface: PascalCase',
      code: `
        interface IUser {}
        interface Foo {}
        interface HTTPClient {}
      `,
    },
    {
      name: 'typeLike: PascalCase classes, type aliases, enums and type parameters',
      code: `
        class UserService<TKey, Value> {}
        type UserId = string;
        enum Status {
          ACTIVE,
          inactive,
          Pending,
          snake_member,
        }
        abstract class Base {}
      `,
    },
    {
      name: "a mapped type's key and an infer type are not type parameters",
      code: `
        type Keys<T> = { [k_key in keyof T]: T[k_key] };
        type Elem<T> = T extends Array<infer elem_type> ? elem_type : never;
      `,
    },
    {
      name: 'catch, index-signature, method-signature and function-type parameters are not checked',
      code: `
        try {
          JSON.parse('x');
        } catch (Bad_Error) {}
        interface ILookup {
          [Bad_Key: string]: unknown;
          find(Bad_Arg: string): void;
        }
        type Fn = (Bad_Param: string) => void;
      `,
    },
    {
      name: 'memberLike private: camelCase; protected and public members fall to default',
      code: `
        class Repo {
          private readonly cache = new Map<string, number>();
          private static instanceCount = 0;
          private load(): void {}
          private get size(): number {
            return 0;
          }
          private set size(value: number) {}
          constructor(
            private readonly userService: object,
            protected _logger: object,
            public API_KEY: string,
          ) {}
        }
      `,
    },
    {
      name: 'a #name member is not private to the rule',
      code: `
        class Box {
          #_raw = 1;
          #Value = 2;
          static #CACHE_SIZE = 3;
        }
      `,
    },
    {
      name: 'object literal and type members in any of the four formats',
      code: `
        const settings = {
          maxRetries: 1,
          MaxRetries: 2,
          max_retries: 3,
          MAX_RETRIES: 4,
          'plain': 5,
          run(): void {},
          get Value(): number {
            return 1;
          },
        };
        type Shape = { user_id: string; UserName: string; onClick: () => void; Render(): void };
      `,
    },
  ].map((test) => ({ ...test, filename, options: WORKSPACE_OPTIONS })),

  invalid: [
    {
      name: 'variable: PascalCase and snake_case',
      code: `
        const UserName = 'a';
        let user_name = 'b';
      `,
      errors: [badFormat('Variable', 'UserName', VARIABLE_FORMAT), badFormat('Variable', 'user_name', VARIABLE_FORMAT)],
    },
    {
      name: 'variable: the ^_ filter belongs to default, so a leading underscore is checked',
      code: `
        const _cache = new Map<string, number>();
        const [_, second] = [1, 2];
        for (const _item of [1, 2]) {}
        const _isReady = true;
      `,
      errors: [
        badFormat('Variable', '_cache', VARIABLE_FORMAT),
        badFormat('Variable', '_', VARIABLE_FORMAT),
        badFormat('Variable', '_item', VARIABLE_FORMAT),
        missingBooleanPrefix('_isReady'),
      ],
    },
    {
      name: 'variable: destructured bindings are variables, the keys they read are not',
      code: `
        declare const source: { user_id: string; profile: { displayName: string } };
        const { user_id, profile: { displayName: Display_Name } } = source;
      `,
      errors: [badFormat('Variable', 'user_id', VARIABLE_FORMAT), badFormat('Variable', 'Display_Name', VARIABLE_FORMAT)],
    },
    {
      name: 'boolean: a boolean variable without one of the prefixes',
      code: `
        const ready = true;
        let enabled: boolean = false;
        declare const loaded: boolean | undefined;
        declare const visible: true | null;
        const IS_PROD = Math.random() > 0.5;
      `,
      errors: [
        missingBooleanPrefix('ready'),
        missingBooleanPrefix('enabled'),
        missingBooleanPrefix('loaded'),
        missingBooleanPrefix('visible'),
        missingBooleanPrefix('IS_PROD'),
      ],
    },
    {
      name: 'boolean: the rest must be PascalCase, and the first prefix that matches is the one trimmed',
      code: `
        const isready = true;
        const includesDrafts = true;
        const has_items = false;
      `,
      errors: [
        badTrimmedBoolean('isready', 'ready'),
        badTrimmedBoolean('includesDrafts', 'sDrafts'),
        badTrimmedBoolean('has_items', '_items'),
      ],
    },
    {
      name: 'boolean: the types option decides before the plain variable option',
      code: `
        const user_flag = true;
        const user_label = 'x';
      `,
      errors: [missingBooleanPrefix('user_flag'), badFormat('Variable', 'user_label', VARIABLE_FORMAT)],
    },
    {
      name: 'interface: PascalCase only, with no ^_ filter',
      code: `
        interface user {}
        interface I_User {}
        interface USER_PROFILE {}
        interface _Hidden {}
      `,
      errors: [
        badFormat('Interface', 'user', 'PascalCase'),
        badFormat('Interface', 'I_User', 'PascalCase'),
        badFormat('Interface', 'USER_PROFILE', 'PascalCase'),
        badFormat('Interface', '_Hidden', 'PascalCase'),
      ],
    },
    {
      name: 'typeLike: classes, type aliases, enums and type parameters',
      code: `
        class user_service<t_key> {}
        type user_id = string;
        enum order_status {
          Active,
        }
        abstract class _Base {}
        const Holder = class inner_holder {};
      `,
      errors: [
        badFormat('Class', 'user_service', 'PascalCase'),
        badFormat('Type Parameter', 't_key', 'PascalCase'),
        badFormat('Type Alias', 'user_id', 'PascalCase'),
        badFormat('Enum', 'order_status', 'PascalCase'),
        badFormat('Class', '_Base', 'PascalCase'),
        badFormat('Variable', 'Holder', VARIABLE_FORMAT),
        badFormat('Class', 'inner_holder', 'PascalCase'),
      ],
    },
    {
      name: 'memberLike private: a leading underscore is forbidden',
      code: `
        class Service {
          private _cache = new Map<string, number>();
          private static readonly _instance = null;
          private _load(): void {}
          private get _size(): number {
            return 0;
          }
          constructor(private readonly _repository: object) {}
        }
      `,
      errors: [
        leadingUnderscore('Class Property', '_cache'),
        leadingUnderscore('Class Property', '_instance'),
        leadingUnderscore('Class Method', '_load'),
        leadingUnderscore('Classic Accessor', '_size'),
        leadingUnderscore('Parameter Property', '_repository'),
      ],
    },
    {
      name: 'memberLike private: camelCase only',
      code: `
        class Limits {
          private static readonly MAX_SIZE = 10;
          private UserName = 'a';
          private load_all(): void {}
          private handler = (): void => {};
          private Handler2 = (): void => {};
          constructor(private user_service: object) {}
        }
      `,
      errors: [
        badFormat('Class Property', 'MAX_SIZE', 'camelCase'),
        badFormat('Class Property', 'UserName', 'camelCase'),
        badFormat('Class Method', 'load_all', 'camelCase'),
        badFormat('Class Method', 'Handler2', 'camelCase'),
        badFormat('Parameter Property', 'user_service', 'camelCase'),
      ],
    },
    {
      name: 'memberLike private takes precedence over default; other accessibilities fall to default',
      code: `
        class Mixed {
          public user_name = 'a';
          protected UserName = 'b';
          private user_name2 = 'c';
        }
      `,
      errors: [badFormat('Class Property', 'user_name2', 'camelCase')],
    },
    {
      name: 'a name that requires quotes matches no format',
      code: `
        const headers = { 'Content-Type': 'json', 'x-api-key': 'k', 1: 'one', '': 'empty', plain: 1, 'quoted': 2 };
        type Row = { 'first name': string };
        enum Mime {
          'text/html' = 'text/html',
        }
        class Table {
          'col-1' = 1;
          'col_2'(): void {}
        }
      `,
      errors: [
        badFormat('Object Literal Property', 'Content-Type', ANY_FORMAT),
        badFormat('Object Literal Property', 'x-api-key', ANY_FORMAT),
        badFormat('Object Literal Property', '1', ANY_FORMAT),
        badFormat('Object Literal Property', '', ANY_FORMAT),
        badFormat('Type Property', 'first name', ANY_FORMAT),
        badFormat('Enum Member', 'text/html', ANY_FORMAT),
        badFormat('Class Property', 'col-1', ANY_FORMAT),
      ],
    },
    {
      name: 'import: default and namespace imports are checked, named imports are not',
      code: `
        import Express_App from 'express';
        import * as Lodash_Fp from 'lodash/fp';
        import { default as Default_Router } from 'express';
        import { named_Export } from 'some-module';
        import { 'string-name' as Aliased_Name } from 'some-module';
      `,
      errors: [
        badFormat('Import', 'Express_App', ANY_FORMAT),
        badFormat('Import', 'Lodash_Fp', ANY_FORMAT),
        badFormat('Import', 'Default_Router', ANY_FORMAT),
        badFormat('Import', 'Aliased_Name', ANY_FORMAT),
      ],
    },
    {
      name: 'function and parameter names fall to default',
      code: `
        function Load_All(User_Id: string, { Nested_Name }: { Nested_Name: string }, ...Rest_Args: string[]): void {}
        const handler = function Named_Handler(Arg_One: string): void {};
        const arrow = (Arrow_Param: string): string => Arrow_Param;
        declare function Declared_Fn(Declared_Param: string): void;
        abstract class Shape {
          abstract area(Unit_Name: string): number;
        }
      `,
      errors: [
        badFormat('Function', 'Load_All', ANY_FORMAT),
        badFormat('Parameter', 'User_Id', ANY_FORMAT),
        badFormat('Parameter', 'Nested_Name', ANY_FORMAT),
        badFormat('Type Property', 'Nested_Name', ANY_FORMAT),
        badFormat('Parameter', 'Rest_Args', ANY_FORMAT),
        badFormat('Function', 'Named_Handler', ANY_FORMAT),
        badFormat('Parameter', 'Arg_One', ANY_FORMAT),
        badFormat('Parameter', 'Arrow_Param', ANY_FORMAT),
        badFormat('Function', 'Declared_Fn', ANY_FORMAT),
        badFormat('Parameter', 'Declared_Param', ANY_FORMAT),
        badFormat('Parameter', 'Unit_Name', ANY_FORMAT),
      ],
    },
    {
      name: 'reports at the name: an annotated variable, a parameter property, a quoted key',
      code: [
        "const user_label: string = 'a';",
        'class Repo {',
        '  constructor(private readonly _repository: object) {}',
        '}',
        "const headers = { 'Content-Type': 'json' };",
      ].join('\n'),
      // oxlint's RuleTester counts columns from 0, as ESTree locations do; ESLint printed them from 1.
      errors: [
        { messageId: 'doesNotMatchFormat', line: 1, column: 6 },
        { messageId: 'unexpectedUnderscore', line: 3, column: 31 },
        { messageId: 'doesNotMatchFormat', line: 5, column: 18 },
      ],
    },
    {
      // typescript-eslint's "requires quotes" case, under this configuration: 6, not 7, because 'foo' is valid.
      name: 'ported: quoted type-literal keys',
      code: `
        type Foo = {
          'foo     Bar': string;
          '': string;
          '0': string;
          'foo': string;
          'foo-bar': string;
          '#foo-bar': string;
        };

        interface Bar {
          'boo-----foo': string;
        }
      `,
      errors: Array.from({ length: 6 }, () => ({ messageId: 'doesNotMatchFormat' }) as const),
    },
  ].map((test) => ({ ...test, filename, options: WORKSPACE_OPTIONS })),
});

ruleTester.run('naming-convention: no options', namingConvention, {
  valid: [{ name: 'the workspace convention applies', filename, code: "const userLabel = 'a';" }],
  invalid: [
    {
      name: 'the workspace convention applies',
      filename,
      code: "const UserLabel = 'a'; const ready = true;",
      errors: [badFormat('Variable', 'UserLabel', VARIABLE_FORMAT), missingBooleanPrefix('ready')],
    },
    {
      // A .js file is in no program (the fixtures tsconfig includes **/*.ts), so tsrs has no types for
      // it: the types option matches nothing there, and the plain variable option decides.
      name: 'in a file of no program, a variable is judged as if its type were not boolean',
      filename: path.join(fixturesDir, 'naming-convention-no-program.js'),
      code: "const ready = true; const user_flag = true; const isReady = true;",
      errors: [badFormat('Variable', 'user_flag', VARIABLE_FORMAT)],
    },
  ],
});

// ---------------------------------------------------------------------------
// typescript-eslint's own cases (tests/rules/naming-convention), for the options this rule accepts
// ---------------------------------------------------------------------------

ruleTester.run('naming-convention: typescript-eslint cases', namingConvention, {
  valid: [
    {
      code: "const child_process = require('child_process');",
      options: [{ filter: { match: false, regex: 'child_process' }, format: ['camelCase'], selector: 'default' }],
    },
    {
      // types: ['boolean'] of the types case; the other types are not options this rule accepts.
      code: `
        declare const ANY_UPPER_CASE: any;
        declare const string_camelCase: string;
        declare const number_camelCase: number;
        declare const boolean_camelCase1: boolean;
        declare const boolean_camelCase2: boolean | null;
        declare const boolean_camelCase3: boolean | null | undefined;
        declare const boolean_camelCase4: true | null | undefined;
        declare const boolean_camelCase5: false | null | undefined;
        declare const boolean_camelCase6: true | false | null | undefined;
      `,
      options: [{ format: ['camelCase'], prefix: ['boolean_'], selector: 'variable', types: ['boolean'] }],
    },
    {
      code: `
        const match = 'test'.match(/test/);
        const [, key, value] = match;
      `,
      options: [{ format: ['camelCase'], selector: 'default' }],
    },
    {
      // typescript-eslint#1478, with the filter as an object: the option with a filter is tried first.
      code: "const child_process = require('child_process');",
      options: [
        { format: ['camelCase', 'UPPER_CASE'], selector: 'variable' },
        { filter: { match: true, regex: 'child_process' }, format: ['snake_case'], selector: 'variable' },
      ],
    },
    {
      code: "const foo = { 'Property-Name': 'asdf' };",
      options: [{ filter: { match: false, regex: '-' }, format: ['camelCase'], selector: 'default' }],
    },
    {
      code: "const foo = { 'Property-Name': 'asdf' };",
      options: [{ filter: { match: false, regex: '^(Property-Name)$' }, format: ['camelCase'], selector: 'default' }],
    },
    {
      code: `
        class foo {
          private fooBoo: number;
        }
      `,
      options: [{ format: ['camelCase'], modifiers: ['private'], selector: 'memberLike' }],
    },
    {
      code: `
        class SomeClass {
          static OtherConstant = 'hello';
        }

        export const { OtherConstant: otherConstant } = SomeClass;
      `,
      options: [
        { format: ['PascalCase'], selector: 'memberLike' },
        { format: ['camelCase'], selector: 'variable' },
      ],
    },
  ].map((test) => ({ ...test, filename })),

  invalid: [
    {
      code: "const child_process = require('child_process');",
      errors: [{ messageId: 'doesNotMatchFormat' }],
      options: [{ filter: { match: true, regex: 'child_process' }, format: ['camelCase'], selector: 'default' }],
    },
    {
      code: `
        declare const any_camelCase01: any;
        declare const any_camelCase02: any | null;
        declare const any_camelCase03: any | null | undefined;
        declare const string_camelCase01: string;
        declare const string_camelCase02: string | null;
        declare const string_camelCase03: string | null | undefined;
        declare const string_camelCase04: 'a' | null | undefined;
        declare const string_camelCase05: string | 'a' | null | undefined;
        declare const number_camelCase06: number;
        declare const number_camelCase07: number | null;
        declare const number_camelCase08: number | null | undefined;
        declare const number_camelCase09: 1 | null | undefined;
        declare const number_camelCase10: number | 2 | null | undefined;
        declare const boolean_camelCase11: boolean;
        declare const boolean_camelCase12: boolean | null;
        declare const boolean_camelCase13: boolean | null | undefined;
        declare const boolean_camelCase14: true | null | undefined;
        declare const boolean_camelCase15: false | null | undefined;
        declare const boolean_camelCase16: true | false | null | undefined;
      `,
      errors: [11, 12, 13, 14, 15, 16].map((index) => ({
        messageId: 'doesNotMatchFormatTrimmed' as const,
        data: {
          type: 'Variable',
          name: `boolean_camelCase${index}`,
          processedName: `camelCase${index}`,
          formats: 'snake_case',
        },
      })),
      options: [{ format: ['snake_case'], prefix: ['boolean_'], selector: 'variable', types: ['boolean'] }],
    },
    {
      code: `
        const foo = {
          'Property Name': 'asdf',
        };
      `,
      errors: [
        {
          data: { formats: 'camelCase', name: 'Property Name', type: 'Object Literal Property' },
          line: 3,
          messageId: 'doesNotMatchFormat',
        },
      ],
      options: [{ filter: { match: false, regex: '-' }, format: ['camelCase'], selector: 'default' }],
    },
    {
      code: `
        class foo {
          private readonly fooBar: boolean;
        }
      `,
      errors: [{ messageId: 'doesNotMatchFormat' }],
      options: [{ format: ['PascalCase'], modifiers: ['private'], selector: 'memberLike' }],
    },
    {
      code: `
        class SomeClass {
          static otherConstant = 'hello';
        }

        export const { otherConstant } = SomeClass;
      `,
      errors: [{ line: 3, messageId: 'doesNotMatchFormat' }],
      options: [
        { format: ['PascalCase'], selector: 'memberLike' },
        { format: ['camelCase'], selector: 'variable' },
      ],
    },
    {
      // Parameters of a method without a body are checked.
      code: `
        declare class Foo {
          Bar(Baz: string): void;
        }
      `,
      errors: [{ line: 3, messageId: 'doesNotMatchFormat' }],
      options: [{ filter: { match: false, regex: '^(Foo|Bar)$' }, format: ['camelCase'], selector: 'default' }],
    },
  ].map((test) => ({ ...test, filename })),
});

// ---------------------------------------------------------------------------
// typescript-eslint's generated cases (cases/createTestCases.ts): every format against names that
// match and break it, with leadingUnderscore 'forbid' and prefixes, for each selector this rule
// accepts. memberLike and typeLike run the code of the member and type selectors they group.
// ---------------------------------------------------------------------------

type Format = 'camelCase' | 'PascalCase' | 'snake_case' | 'UPPER_CASE';

const FORMAT_TEST_NAMES: Readonly<Record<Format, { readonly valid: string[]; readonly invalid: string[] }>> = {
  camelCase: {
    invalid: ['snake_case', 'UPPER_CASE', 'UPPER', 'StrictPascalCase'],
    valid: ['strictCamelCase', 'lower', 'camelCaseUNSTRICT'],
  },
  PascalCase: {
    invalid: ['snake_case', 'UPPER_CASE', 'strictCamelCase'],
    valid: ['StrictPascalCase', 'Pascal', 'I18n', 'PascalCaseUNSTRICT', 'UPPER'],
  },
  snake_case: {
    invalid: ['UPPER_CASE', 'SNAKE_case_UNSTRICT', 'strictCamelCase', 'StrictPascalCase'],
    valid: ['snake_case', 'lower'],
  },
  UPPER_CASE: {
    invalid: ['lower', 'snake_case', 'SNAKE_case_UNSTRICT', 'strictCamelCase', 'StrictPascalCase'],
    valid: ['UPPER_CASE', 'UPPER'],
  },
};

// Not matching [iI]gnored: the scaffolding names in the code are left alone.
const IGNORED_FILTER = { match: false, regex: '.gnored' };

interface IGeneratedCases {
  readonly code: readonly string[];
  readonly options: { readonly selector: string; readonly modifiers?: readonly string[] };
  /** typescript-eslint asserts the message data only for individual selectors. */
  readonly label?: string;
}

const PROPERTY_CODE = [
  'class Ignored { private % }',
  'class Ignored { private "%" = 1 }',
  'class Ignored { private readonly % = 1 }',
  'class Ignored { private static % }',
  'class Ignored { private static readonly % = 1 }',
  // oxlint parses an abstract member only inside an abstract class.
  'abstract class Ignored { abstract % }',
  'class Ignored { declare % }',
  'class Ignored { #% }',
  'class Ignored { static #% }',
  'const ignored = { % };',
  'const ignored = { "%": 1 };',
  'interface Ignored { % }',
  'interface Ignored { "%": string }',
  'type Ignored = { % }',
  'type Ignored = { "%": string }',
];

const PARAMETER_PROPERTY_CODE = [
  'class Ignored { constructor(private %) {} }',
  'class Ignored { constructor(readonly %) {} }',
  'class Ignored { constructor(private readonly %) {} }',
];

const METHOD_CODE = [
  'class Ignored { private %() {} }',
  'class Ignored { private "%"() {} }',
  'class Ignored { private async %() {} }',
  'class Ignored { private static %() {} }',
  'class Ignored { private static async %() {} }',
  'class Ignored { private % = () => {} }',
  'abstract class Ignored { abstract %() }',
  'class Ignored { #%() }',
  'class Ignored { static #%() }',
  'const ignored = { %() {} };',
  'const ignored = { "%"() {} };',
  'const ignored = { %: () => {} };',
  'interface Ignored { %(): string }',
  'interface Ignored { "%"(): string }',
  'interface Ignored { %: () => string }',
  'interface Ignored { "%": () => string }',
  'type Ignored = { %(): string }',
  'type Ignored = { "%"(): string }',
  'type Ignored = { %: () => string }',
  'type Ignored = { "%": () => string }',
];

const ACCESSOR_CODE = [
  'class Ignored { accessor % = 10; }',
  'class Ignored { accessor #% = 10; }',
  'class Ignored { static accessor % = 10; }',
  'class Ignored { static accessor #% = 10; }',
  'class Ignored { private accessor % = 10; }',
  'class Ignored { private static accessor % = 10; }',
  'class Ignored { override accessor % = 10; }',
  'class Ignored { accessor "%" = 10; }',
  'class Ignored { protected accessor % = 10; }',
  'class Ignored { public accessor % = 10; }',
  'abstract class Ignored { abstract accessor %; }',
  'const ignored = { get %() {} };',
  'const ignored = { set "%"(ignored) {} };',
  'class Ignored { private get %() {} }',
  'class Ignored { private set "%"(ignored) {} }',
  'class Ignored { private static get %() {} }',
  'class Ignored { static get #%() {} }',
  'abstract class Ignored { abstract get %(): number }',
  'abstract class Ignored { abstract set %(ignored: number) }',
];

const ENUM_MEMBER_CODE = ['enum Ignored { % }', 'enum Ignored { "%" }'];

const GENERATED_CASES: readonly IGeneratedCases[] = [
  {
    code: [
      'const % = 1;',
      'function % () {}',
      '(function (%) {});',
      'class Ignored { constructor(private %) {} }',
      'const ignored = { % };',
      'interface Ignored { %: string }',
      'type Ignored = { %: string }',
      'class Ignored { private % = 1 }',
      'class Ignored { #% = 1 }',
      'class Ignored { constructor(private %) {} }',
      'class Ignored { #%() {} }',
      'class Ignored { private %() {} }',
      'const ignored = { %() {} };',
      'class Ignored { private get %() {} }',
      'enum Ignored { % }',
      'abstract class % {}',
      'interface % { }',
      'type % = { };',
      'enum % {}',
      'interface Ignored<%> extends Ignored<string> {}',
    ],
    options: { selector: 'default' },
  },
  {
    code: [
      'const % = 1;',
      'let % = 1;',
      'var % = 1;',
      'const {%} = {ignored: 1};',
      'const {% = 2} = {ignored: 1};',
      'const {...%} = {ignored: 1};',
      'const [%] = [1];',
      'const [% = 1] = [1];',
      'const [...%] = [1];',
    ],
    options: { selector: 'variable' },
    label: 'Variable',
  },
  { code: ['interface % {}'], options: { selector: 'interface' }, label: 'Interface' },
  {
    code: [
      'class % {}',
      'abstract class % {}',
      'const ignored = class % {}',
      'interface % {}',
      'type % = {};',
      'type % = 1;',
      'enum % {}',
      'class Ignored<%> {}',
      'function ignored<%>() {}',
      'type Ignored<%> = { ignored: % };',
      'interface Ignored<%> extends Ignored<string> {}',
    ],
    options: { selector: 'typeLike' },
  },
  {
    code: [...PROPERTY_CODE, ...PARAMETER_PROPERTY_CODE, ...METHOD_CODE, ...ACCESSOR_CODE, ...ENUM_MEMBER_CODE],
    options: { selector: 'memberLike' },
  },
  {
    // The members each code above declares private.
    code: [...PROPERTY_CODE, ...PARAMETER_PROPERTY_CODE, ...METHOD_CODE, ...ACCESSOR_CODE].filter((code) =>
      /\bprivate\b/.test(code),
    ),
    options: { selector: 'memberLike', modifiers: ['private'] },
  },
];

type GeneratedOptions = IGeneratedCases['options'] & {
  readonly format: readonly Format[];
  readonly leadingUnderscore?: 'forbid';
  readonly prefix?: readonly string[];
};

/**
 * One file holding every line of the case, each in a block of its own: oxlint's parser rejects the
 * redeclarations (`class Ignored` twice) that typescript-estree let the upstream cases make.
 */
function generatedCode(cases: IGeneratedCases, name: string, options: GeneratedOptions): string {
  const lines = cases.code.map((code) => `{ ${code.replaceAll('%', name)} }`);

  return `// ${JSON.stringify(options)}\n${lines.join('\n')}`;
}

function generatedOptions(options: GeneratedOptions): unknown[] {
  return [{ ...options, filter: IGNORED_FILTER }];
}

const PREFIX_SINGLE = ['MyPrefix'];
const PREFIX_MULTI = ['MyPrefix1', 'MyPrefix2'];

const generatedValid = GENERATED_CASES.flatMap((cases) =>
  Object.entries(FORMAT_TEST_NAMES).flatMap(([formatName, names]) =>
    names.valid.flatMap((name) => {
      const format = [formatName as Format];
      const valid = (preparedName: string, options: GeneratedOptions) => ({
        filename,
        code: generatedCode(cases, preparedName, options),
        options: generatedOptions(options),
      });

      return [
        valid(name, { ...cases.options, format }),
        valid(name, { ...cases.options, format, leadingUnderscore: 'forbid' }),
        valid(`MyPrefix${name}`, { ...cases.options, format, prefix: PREFIX_SINGLE }),
        valid(`MyPrefix2${name}`, { ...cases.options, format, prefix: PREFIX_MULTI }),
      ];
    }),
  ),
);

const generatedInvalid = GENERATED_CASES.flatMap((cases) =>
  Object.entries(FORMAT_TEST_NAMES).flatMap(([formatName, names]) =>
    names.invalid.flatMap((name) => {
      const format = [formatName as Format];
      const invalid = (
        preparedName: string,
        options: GeneratedOptions,
        messageId: 'doesNotMatchFormat' | 'missingAffix' | 'unexpectedUnderscore',
        data: Record<string, string>,
      ) => ({
        filename,
        code: generatedCode(cases, preparedName, options),
        options: generatedOptions(options),
        errors: cases.code.map(() =>
          cases.label === undefined
            ? { messageId }
            : { messageId, data: { name: preparedName, type: cases.label, ...data } },
        ),
      });

      return [
        invalid(name, { ...cases.options, format }, 'doesNotMatchFormat', { formats: format.join(', ') }),
        invalid(`_${name}`, { ...cases.options, format, leadingUnderscore: 'forbid' }, 'unexpectedUnderscore', {
          position: 'leading',
        }),
        invalid(name, { ...cases.options, format, prefix: PREFIX_SINGLE }, 'missingAffix', {
          affixes: PREFIX_SINGLE.join(', '),
          position: 'prefix',
        }),
        invalid(name, { ...cases.options, format, prefix: PREFIX_MULTI }, 'missingAffix', {
          affixes: PREFIX_MULTI.join(', '),
          position: 'prefix',
        }),
      ];
    }),
  ),
);

ruleTester.run('naming-convention: typescript-eslint generated cases', namingConvention, {
  valid: generatedValid,
  invalid: generatedInvalid,
});

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

describe('naming-convention options', () => {
  /** The error oxlint raises for the options, or undefined when it accepts them. */
  function optionsError(options: readonly unknown[]): string | undefined {
    const { describe: suite, it: test } = RuleTester;

    // Run the case here, inside this test, rather than registering one.
    RuleTester.describe = (_text, method) => method();
    RuleTester.it = (_text, method) => method();

    try {
      new RuleTester().run('naming-convention', namingConvention, {
        valid: [{ filename, code: "const userLabel = 'a';", options: [...options] }],
        invalid: [],
      });

      return undefined;
    } catch (error) {
      return String(error);
    } finally {
      RuleTester.describe = suite;
      RuleTester.it = test;
    }
  }

  it('accepts the workspace options', () => {
    expect(optionsError(WORKSPACE_OPTIONS)).toBeUndefined();
  });

  it.each([
    ['a selector it does not support', [{ selector: 'class', format: ['PascalCase'] }]],
    ['a selector array', [{ selector: ['variable'], format: ['camelCase'] }]],
    ['a format it does not support', [{ selector: 'variable', format: ['strictCamelCase'] }]],
    ['a missing format', [{ selector: 'memberLike', modifiers: ['private'] }]],
    ['a modifier it does not support', [{ selector: 'memberLike', modifiers: ['readonly'], format: ['camelCase'] }]],
    ['modifiers on variable', [{ selector: 'variable', modifiers: ['private'], format: ['camelCase'] }]],
    ['types outside variable', [{ selector: 'default', types: ['boolean'], format: ['camelCase'] }]],
    ['a type it does not support', [{ selector: 'variable', types: ['string'], format: ['camelCase'] }]],
    ['a leadingUnderscore it does not support', [{ selector: 'variable', format: ['camelCase'], leadingUnderscore: 'allow' }]],
    ['a filter given as a string', [{ selector: 'default', format: ['camelCase'], filter: '^_' }]],
    ['custom', [{ selector: 'variable', format: ['camelCase'], custom: { regex: 'x', match: true } }]],
  ])('rejects %s', (_label, options) => {
    expect(optionsError(options)).toMatch(/Options validation failed/);
  });
});
