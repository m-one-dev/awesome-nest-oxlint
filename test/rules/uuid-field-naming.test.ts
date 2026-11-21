import * as path from 'node:path';
import { RuleTester } from 'oxlint/plugins-dev';

import { uuidFieldNaming } from '../../src/rules/uuid-field-naming.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures');
const filename = path.join(fixturesDir, 'uuid-field-naming.ts');

const ruleTester = new RuleTester();

const preamble = `
  type Uuid = string & { _uuidBrand: undefined };
  type UserId = Uuid;
  type StripeId = string;
`;

ruleTester.run('uuid-field-naming', uuidFieldNaming, {
  valid: [
    {
      // The source spells the name longer than it reads, so TypeScript's identifier ends past start + name.length.
      name: 'a unicode escape in the name: Uuid named userId',
      filename,
      code: `${preamble}
        const \\u0075serId: Uuid = '' as Uuid;
      `,
    },
    {
      name: 'class field: Uuid named userId',
      filename,
      code: `${preamble}
        class FooDto { userId!: Uuid; }
      `,
    },
    {
      name: 'class field: Uuid[] named userIds',
      filename,
      code: `${preamble}
        class FooDto { userIds!: Uuid[]; }
      `,
    },
    {
      name: 'class field: bare id of type Uuid',
      filename,
      code: `${preamble}
        class FooDto { id!: Uuid; }
      `,
    },
    {
      name: 'class field: bare ids of type Uuid[]',
      filename,
      code: `${preamble}
        class FooDto { ids!: Uuid[]; }
      `,
    },
    {
      name: 'optional Uuid field still passes when name ends with Id',
      filename,
      code: `${preamble}
        class FooDto { userId?: Uuid; }
      `,
    },
    {
      name: 'Uuid | undefined union still passes',
      filename,
      code: `${preamble}
        class FooDto { userId!: Uuid | undefined; }
      `,
    },
    {
      name: 'aliased UserId resolves structurally and userId passes',
      filename,
      code: `${preamble}
        class FooDto { userId!: UserId; }
      `,
    },
    {
      name: 'interface member named projectId',
      filename,
      code: `${preamble}
        interface IFoo { projectId: Uuid; }
      `,
    },
    {
      name: 'type literal member named projectIds',
      filename,
      code: `${preamble}
        type Foo = { projectIds: Uuid[] };
      `,
    },
    {
      name: 'constructor parameter property userId: Uuid',
      filename,
      code: `${preamble}
        class FooService {
          constructor(private readonly userId: Uuid) {}
        }
      `,
    },
    {
      name: 'function parameter named id',
      filename,
      code: `${preamble}
        function findOne(id: Uuid) { return id; }
      `,
    },
    {
      name: 'rest parameter ids: Uuid[]',
      filename,
      code: `${preamble}
        function findMany(...ids: Uuid[]) { return ids; }
      `,
    },
    {
      name: 'ReadonlyArray<Uuid> with name userIds',
      filename,
      code: `${preamble}
        class FooDto { userIds!: ReadonlyArray<Uuid>; }
      `,
    },
    {
      name: 'readonly Uuid[] with name userIds',
      filename,
      code: `${preamble}
        class FooDto { userIds!: readonly Uuid[]; }
      `,
    },
    {
      name: 'unrelated string field',
      filename,
      code: `${preamble}
        class FooDto { name!: string; }
      `,
    },
    {
      name: 'paid: boolean is not flagged (regex excludes)',
      filename,
      code: `${preamble}
        class FooDto { paid!: boolean; }
      `,
    },
    {
      name: 'valid: boolean is not flagged',
      filename,
      code: `${preamble}
        class FooDto { valid!: boolean; }
      `,
    },
    {
      name: 'idempotencyKey: string is not flagged',
      filename,
      code: `${preamble}
        class FooDto { idempotencyKey!: string; }
      `,
    },
    {
      name: 'Promise<Uuid> field is skipped',
      filename,
      code: `${preamble}
        class FooDto { pending!: Promise<Uuid>; }
      `,
    },
    {
      name: 'Record<string, Uuid> with non-id name is skipped',
      filename,
      code: `${preamble}
        class FooDto { lookup!: Record<string, Uuid>; }
      `,
    },
    {
      name: 'inferred local: const userId = uuid()',
      filename,
      code: `${preamble}
        declare function genUuid(): Uuid;
        const userId = genUuid();
      `,
    },
    {
      name: 'destructuring: { userId } from { userId: Uuid }',
      filename,
      code: `${preamble}
        declare const obj: { userId: Uuid };
        const { userId } = obj;
      `,
    },
    {
      name: 'reverse off by default: userId: string allowed',
      filename,
      code: `${preamble}
        class FooDto { userId!: string; }
      `,
    },
    {
      name: 'reverse on with allowNonUuidNames exempt',
      filename,
      code: `${preamble}
        class FooDto { stripeCustomerId!: string; }
      `,
      options: [
        {
          enforceReverse: true,
          allowNonUuidNames: ['^stripe.*Id$'],
        },
      ],
    },
    {
      name: 'reverse on: userId: Uuid still passes',
      filename,
      code: `${preamble}
        class FooDto { userId!: Uuid; }
      `,
      options: [{ enforceReverse: true }],
    },
    {
      name: 'reverse on: userIds: Uuid[] still passes',
      filename,
      code: `${preamble}
        class FooDto { userIds!: Uuid[]; }
      `,
      options: [{ enforceReverse: true }],
    },
    {
      name: 'object literal under contextual type with correct names',
      filename,
      code: `${preamble}
        interface IPayload { userId: Uuid; userIds: Uuid[] }
        declare const someId: Uuid;
        declare const someIds: Uuid[];
        const p: IPayload = { userId: someId, userIds: someIds };
      `,
    },
    {
      name: 'inline object literal without contextual type is skipped',
      filename,
      code: `${preamble}
        declare const someId: Uuid;
        const o = { foo: someId };
      `,
    },
    {
      name: 'function return type does not affect function name',
      filename,
      code: `${preamble}
        function getUuid(): Uuid { return null as unknown as Uuid; }
      `,
    },
    {
      name: 'private identifier field #userId',
      filename,
      code: `${preamble}
        class FooService { #userId!: Uuid; }
      `,
    },
    {
      name: 'computed key with Uuid type is skipped',
      filename,
      code: `${preamble}
        const KEY = 'foo';
        class FooDto { [KEY]!: Uuid; }
      `,
    },
    {
      name: 'any-typed userId is skipped',
      filename,
      code: `${preamble}
        class FooDto { userId!: any; }
      `,
      options: [{ enforceReverse: true }],
    },
    {
      name: 'unknown-typed userId is skipped',
      filename,
      code: `${preamble}
        class FooDto { userId!: unknown; }
      `,
      options: [{ enforceReverse: true }],
    },
  ],

  invalid: [
    {
      name: 'a unicode escape in the name: Uuid named user',
      filename,
      code: `${preamble}
        class FooDto { \\u0075ser!: Uuid; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId', data: { name: 'user' } }],
    },
    {
      name: 'class field: Uuid named user',
      filename,
      code: `${preamble}
        class FooDto { user!: Uuid; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'class field: Uuid[] named users',
      filename,
      code: `${preamble}
        class FooDto { users!: Uuid[]; }
      `,
      errors: [{ messageId: 'uuidArrayFieldMustEndWithIds' }],
    },
    {
      name: 'class field: Uuid[] mistakenly named userId',
      filename,
      code: `${preamble}
        class FooDto { userId!: Uuid[]; }
      `,
      errors: [{ messageId: 'uuidArrayFieldMustEndWithIds' }],
    },
    {
      name: 'class field: aliased UserId named user',
      filename,
      code: `${preamble}
        class FooDto { user!: UserId; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'optional Uuid with bad name',
      filename,
      code: `${preamble}
        class FooDto { user?: Uuid; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'mixed union Uuid | string with bad name',
      filename,
      code: `${preamble}
        class FooDto { user!: Uuid | string; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'interface member with bad name',
      filename,
      code: `${preamble}
        interface IFoo { project: Uuid; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'type literal member with bad name',
      filename,
      code: `${preamble}
        type Foo = { project: Uuid };
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'constructor parameter property with bad name',
      filename,
      code: `${preamble}
        class FooService {
          constructor(private readonly user: Uuid) {}
        }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'rest parameter Uuid[] with singular name',
      filename,
      code: `${preamble}
        function findMany(...id: Uuid[]) { return id; }
      `,
      errors: [{ messageId: 'uuidArrayFieldMustEndWithIds' }],
    },
    {
      name: 'destructuring binding with bad name (renamed)',
      filename,
      code: `${preamble}
        declare const obj: { userId: Uuid };
        const { userId: user } = obj;
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'function parameter local Uuid with bad name',
      filename,
      code: `${preamble}
        function foo(user: Uuid) { return user; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'inferred local Uuid with bad name',
      filename,
      code: `${preamble}
        declare function genUuid(): Uuid;
        const user = genUuid();
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'string-literal property key with Uuid type',
      filename,
      code: `${preamble}
        type Foo = { 'user-id': Uuid };
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      name: 'reverse on: userId: string flagged',
      filename,
      code: `${preamble}
        class FooDto { userId!: string; }
      `,
      options: [{ enforceReverse: true }],
      errors: [{ messageId: 'idSuffixRequiresUuid' }],
    },
    {
      name: 'reverse on: userIds: string[] flagged',
      filename,
      code: `${preamble}
        class FooDto { userIds!: string[]; }
      `,
      options: [{ enforceReverse: true }],
      errors: [{ messageId: 'idsSuffixRequiresUuidArray' }],
    },
    {
      name: 'reverse on: bare id: string flagged',
      filename,
      code: `${preamble}
        class FooDto { id!: string; }
      `,
      options: [{ enforceReverse: true }],
      errors: [{ messageId: 'idSuffixRequiresUuid' }],
    },
    {
      name: 'reverse on: numeric userId: number flagged',
      filename,
      code: `${preamble}
        class FooDto { userId!: number; }
      `,
      options: [{ enforceReverse: true }],
      errors: [{ messageId: 'idSuffixRequiresUuid' }],
    },
    {
      name: 'reverse on: alias-of-string StripeId flagged',
      filename,
      code: `${preamble}
        class FooDto { customerId!: StripeId; }
      `,
      options: [{ enforceReverse: true }],
      errors: [{ messageId: 'idSuffixRequiresUuid' }],
    },
    {
      name: 'reverse on: allowNonUuidNames does not exempt forward direction',
      filename,
      code: `${preamble}
        class FooDto { stripeUser!: Uuid; }
      `,
      options: [{ enforceReverse: true, allowNonUuidNames: ['^stripe.*$'] }],
      errors: [{ messageId: 'uuidFieldMustEndWithId' }],
    },
    {
      // The literal's key is checked against the property its contextual type declares.
      name: 'object literal under contextual type with bad name',
      filename,
      code: `${preamble}
        interface Payload { owner: Uuid; }
        declare const ownerId: Uuid;
        const payload: Payload = { owner: ownerId };
      `,
      errors: [
        {
          messageId: 'uuidFieldMustEndWithId',
          data: { name: 'owner' },
          line: 6,
        },
        {
          messageId: 'uuidFieldMustEndWithId',
          data: { name: 'owner' },
          line: 8,
        },
      ],
    },
    {
      // A parameter of a function type sits in a type position.
      name: 'function type parameter Uuid with bad name',
      filename,
      code: `${preamble}
        type Handler = (user: Uuid) => void;
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId', data: { name: 'user' } }],
    },
    {
      // A homogeneous tuple folds to its element type, compared by type id.
      name: 'tuple of Uuid with non-Ids name',
      filename,
      code: `${preamble}
        class FooDto { members!: [Uuid, Uuid]; }
      `,
      errors: [
        {
          messageId: 'uuidArrayFieldMustEndWithIds',
          data: { name: 'members' },
        },
      ],
    },
    {
      // A method signature's parameter sits in a type position.
      name: 'interface method signature parameter Uuid with bad name',
      filename,
      code: `${preamble}
        interface UserService { load(user: Uuid): void; }
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId', data: { name: 'user' } }],
    },
    {
      // A declared function has no body, like an overload or an abstract method.
      name: 'declare function parameter Uuid with bad name',
      filename,
      code: `${preamble}
        declare function load(user: Uuid): void;
      `,
      errors: [{ messageId: 'uuidFieldMustEndWithId', data: { name: 'user' } }],
    },
    {
      name: 'overload and abstract method parameters Uuid with bad names',
      filename,
      code: `${preamble}
        abstract class Loader {
          abstract load(owner: Uuid): void;
          find(member: Uuid): void;
          find(member: Uuid): void {}
        }
      `,
      errors: [
        { messageId: 'uuidFieldMustEndWithId', data: { name: 'owner' } },
        { messageId: 'uuidFieldMustEndWithId', data: { name: 'member' } },
        { messageId: 'uuidFieldMustEndWithId', data: { name: 'member' } },
      ],
    },
  ],
});
