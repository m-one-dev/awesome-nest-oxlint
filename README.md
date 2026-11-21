# @m-one-dev/awesome-nest-oxlint

Opinionated [oxlint](https://oxc.rs/docs/guide/usage/linter.html) plugin with NestJS-aware rules used across m-one projects. The type-aware rules get type information from [tsrs](https://github.com/oxc-project/tsrs), through its synchronous Node API.

It runs on oxlint only. The same rules for ESLint are [`@m-one-dev/awesome-nest-eslint`](https://github.com/m-one-dev/awesome-nest-eslint).

## Install

```bash
pnpm add -D @m-one-dev/awesome-nest-oxlint oxlint tsrs@0.24.0-ts7.1.0-beta
```

## Usage

```jsonc
// .oxlintrc.json
{
  "jsPlugins": [{ "name": "awesome-nest", "specifier": "@m-one-dev/awesome-nest-oxlint" }],
  "options": { "typeAware": true },
  "rules": {
    "awesome-nest/no-typeorm-finder-methods": "error",
    "awesome-nest/valid-typeorm-join-path": "error"
  }
}
```

Each oxlint process opens one tsrs session. A file is checked in the first program that contains it: the nearest `tsconfig.json`, or a `tsconfig.typecheck.json` beside it, walking up to the package root. A file in no program gets no type-aware checks. When tsrs cannot answer (it will not start, it dies, or a query fails), the lint fails on that file with the cause.

## Rules

| Rule | Types | Checks |
|---|---|---|
| [`dto-decorator-optionality-must-match-type`](./docs/rules/) | yes | `*Optional` decorators match `?`, and `nullable: true` matches a type that includes `null` |
| [`dto-must-extend-abstract-or-base`](./docs/rules/dto-must-extend-abstract-or-base.md) | yes | DTOs transitively extend `AbstractDto` / `BaseDto` |
| [`max-typeorm-joins`](./docs/rules/) | yes | at most 3 joins per `createQueryBuilder` chain |
| [`naming-convention`](./docs/rules/naming-convention.md) | yes | the workspace's naming convention, a subset of typescript-eslint's rule |
| [`no-api-property-decorator`](./docs/rules/) | no | DTOs use the field decorators, not `@ApiProperty` |
| [`no-builtin-exception-instantiation`](./docs/rules/) | no | domain exceptions instead of Nest's built-in ones |
| [`no-double-cast-laundering`](./docs/rules/no-double-cast-laundering.md) | no | bans `as unknown as X` |
| [`no-dto-direct-instantiation`](./docs/rules/no-dto-direct-instantiation.md) | no | DTOs are built with `.create()` |
| [`no-duplicate-module-entries`](./docs/rules/) | no | a class appears once per `@Module` array |
| [`no-implicit-enum-to-string`](./docs/rules/no-implicit-enum-to-string.md) | yes | a string enum is not passed where a plain `string` is expected |
| [`no-typeorm-finder-methods`](./docs/rules/no-typeorm-finder-methods.md) | yes | bans TypeORM entity-read finders, auto-fixing to `createQueryBuilder` chains |
| [`payload-type-suffix`](./docs/rules/payload-type-suffix.md) | yes | NATS payload types end with `PayloadDto` / pagination DTO suffixes |
| [`prefer-promise-all`](./docs/rules/) | no | independent awaits run with `Promise.all` |
| [`prefer-raw-terminal-on-select`](./docs/rules/prefer-raw-terminal-on-select.md) | yes | a chain that selects ends with `getRawOne` / `getRawMany<T>()` |
| [`require-api-endpoint-docs`](./docs/rules/) | no | every endpoint carries its Swagger docs |
| [`require-client-action-on-nats-pattern`](./docs/rules/require-client-action-on-nats-pattern.md) | no | NATS patterns name a client action |
| [`require-object-literal-anchor`](./docs/rules/require-object-literal-anchor.md) | yes | an object literal with no contextual type is anchored with `satisfies` |
| [`require-use-dto-decorator`](./docs/rules/require-use-dto-decorator.md) | yes | entities carry `@UseDto` |
| [`swagger-matches-return-type`](./docs/rules/) | yes | the success Swagger `type` matches the return type |
| [`unique-endpoint-dtos`](./docs/rules/unique-endpoint-dtos.md) | yes | each endpoint slot (`@Body`, `@Query`, response) uses its own DTO across the program; the usage in the file whose path sorts first owns it |
| [`uuid-field-naming`](./docs/rules/) | yes | `Uuid` names end with `Id`, `Uuid[]` with `Ids` |
| [`valid-typeorm-join-path`](./docs/rules/valid-typeorm-join-path.md) | yes | a join names a real relation on an alias already in the chain |

awesome-nest-eslint's `no-unused-injectable` needs the whole workspace at once, so it is not a rule here.

## Requirements

- `oxlint >= 1.93.0`, with `options.typeAware: true`
- `tsrs` at the version in `peerDependencies`: the rules use its API, so upgrade them together

## Development

```bash
pnpm install
pnpm build
pnpm test   # oxlint's RuleTester, under vitest
```

## Releasing

Releases are tag-driven. Bump the version in `package.json`, commit, then tag:

```bash
git add package.json
git commit -m "chore: bump version to x.y.z"
git tag vx.y.z
git push --follow-tags
```

The `publish.yml` workflow runs `install → build → test → pnpm publish` on every `v*` tag and pushes to npmjs.com using the `NPM_TOKEN` repository secret.
