import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import { isCallExpression, isDecorator, isIdentifier, isPropertyAccessExpression } from 'tsrs/ast';
import { type Checker, type Symbol as TsSymbol, SymbolFlags, type Type, TypeFlags, type TypeReference, type UnionOrIntersectionType } from 'tsrs/sync';

import { type IFileTypes, typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';
import { findVariable } from '../utils/find-variable.js';

type MessageIds =
  | 'unknownAlias'
  | 'unknownProperty'
  | 'notARelation'
  | 'unknownMapProperty';

type Options = [];

/** Joins whose relation path is argument 0 and whose new alias is argument 1. */
const PATH_FIRST_JOINS: ReadonlySet<string> = new Set([
  'leftJoin',
  'innerJoin',
  'leftJoinAndSelect',
  'innerJoinAndSelect',
]);

/**
 * `*AndMap*` joins take `mapToProperty` first, so the relation path is argument
 * 1 and the new alias argument 2.
 */
const MAP_JOINS: ReadonlySet<string> = new Set([
  'leftJoinAndMapOne',
  'leftJoinAndMapMany',
  'innerJoinAndMapOne',
  'innerJoinAndMapMany',
]);

const RELATION_DECORATORS: ReadonlySet<string> = new Set([
  'ManyToOne',
  'OneToMany',
  'OneToOne',
  'ManyToMany',
]);

const QUERY_BUILDER_TYPE_NAMES: ReadonlySet<string> = new Set([
  'SelectQueryBuilder',
  'QueryBuilder',
]);

const MAX_HERITAGE_DEPTH = 15;

/** What the alias table knows about one alias in a chain. */
interface IAliasEntry {
  /**
   * The entity type behind the alias, or null when the join that introduced it
   * was a shape the rule does not resolve (raw table name, subquery). The alias
   * is still *known* — only its properties are unverifiable.
   */
  entityType: Type | null;
}

interface IJoinCall {
  node: TSESTree.CallExpression;
  method: string;
  /** Argument holding the `alias.property` relation path, if it is a literal. */
  pathArgument: TSESTree.Node | undefined;
  /** Argument naming the alias this join introduces, if it is a literal. */
  aliasArgument: TSESTree.Node | undefined;
  /** `mapToProperty` — `*AndMap*` joins only. */
  mapArgument: TSESTree.Node | undefined;
  /** The builder the join is called on; its type decides whether this is TypeORM at all. */
  receiver: TSESTree.Node;
}

function literalString(node: TSESTree.Node | undefined): string | null {
  if (!node) {
    return null;
  }

  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
    return node.value;
  }

  // A template literal with no substitutions is still a constant.
  if (
    node.type === AST_NODE_TYPES.TemplateLiteral &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]!.value.cooked;
  }

  return null;
}

export const validTypeormJoinPath = createRule<Options, MessageIds>({
  name: 'valid-typeorm-join-path',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Checks that TypeORM join strings name a real relation on a real alias. See the write-queries skill.',
    },
    messages: {
      unknownAlias:
        "Alias '{{alias}}' is not defined at this point in the query. Aliases available here: {{available}}. TypeORM resolves join aliases in order, so the join that introduces '{{alias}}' must come first.",
      unknownProperty:
        "'{{property}}' is not a property of {{entity}}. TypeORM will throw \"Relation with property path {{property}} in entity was not found\" when this query is built.",
      notARelation:
        "'{{entity}}.{{property}}' exists but is not a relation, so it cannot be joined. Only @ManyToOne, @OneToMany, @OneToOne and @ManyToMany properties are joinable.",
      unknownMapProperty:
        "'{{property}}' is not a property of {{entity}}, so the join result has nowhere to map to.",
    },
    schema: [],
  },
  create(context): TSESLint.RuleListener {
    // TypeScript's view of this file, asked for once the whole file has been walked.
    let types: IFileTypes;
    let checker: Checker;

    function symbolIsFromTypeorm(symbol: TsSymbol | undefined): boolean {
      if (!symbol) {
        return false;
      }

      const visited = new Set<number>();
      const stack: TsSymbol[] = [symbol];

      while (stack.length > 0) {
        const current = stack.pop();

        if (!current || visited.has(current.id)) {
          continue;
        }

        visited.add(current.id);

        if (current.declarations.some((decl) => /[\\/]typeorm[\\/]/.test(decl.path))) {
          return true;
        }

        if ((current.flags & SymbolFlags.Alias) !== 0) {
          const aliased = checker.getAliasedSymbol(current);

          if (aliased.id !== current.id) {
            stack.push(aliased);
          }
        }
      }

      return false;
    }

    /**
     * Returns the `Entity` of a `SelectQueryBuilder<Entity>`, or null when the
     * receiver is not a TypeORM builder at all (a look-alike with its own
     * `leftJoin` must not be linted).
     */
    function queryBuilderEntity(type: Type): Type | null {
      const seen = new Set<number>();
      const stack: Array<{ type: Type; depth: number }> = [
        { type, depth: 0 },
      ];

      while (stack.length > 0) {
        const current = stack.pop();

        if (!current || seen.has(current.type.id)) {
          continue;
        }

        seen.add(current.type.id);

        if (current.depth > MAX_HERITAGE_DEPTH) {
          continue;
        }

        if (current.type.isUnionType() || current.type.isIntersectionType()) {
          for (const sub of (current.type as UnionOrIntersectionType).getTypes()) {
            stack.push({ type: sub, depth: current.depth + 1 });
          }

          continue;
        }

        const symbol = current.type.getSymbol();
        const name = symbol?.name;

        if (
          name &&
          QUERY_BUILDER_TYPE_NAMES.has(name) &&
          symbolIsFromTypeorm(symbol)
        ) {
          const args = checker.getTypeArguments(current.type as TypeReference);

          return args[0] ?? null;
        }

        for (const base of current.type.getBaseTypes() ?? []) {
          stack.push({ type: base, depth: current.depth + 1 });
        }
      }

      return null;
    }

    function typeAt(node: TSESTree.Node): Type {
      return checker.getTypeAtLocation(types.nodeFor(node));
    }

    function unwrapChain(node: TSESTree.Node): TSESTree.Node {
      return node.type === AST_NODE_TYPES.ChainExpression
        ? node.expression
        : node;
    }

    function isCreateQueryBuilderCall(node: TSESTree.Node): boolean {
      return (
        node.type === AST_NODE_TYPES.CallExpression &&
        node.callee.type === AST_NODE_TYPES.MemberExpression &&
        node.callee.property.type === AST_NODE_TYPES.Identifier &&
        node.callee.property.name === 'createQueryBuilder'
      );
    }

    const originCache = new WeakMap<
      TSESTree.Node,
      TSESTree.CallExpression | null
    >();

    /**
     * Walks an expression down to whatever the chain is rooted in. Returns the
     * `createQueryBuilder` call when it is inline, otherwise the deepest node —
     * typically the identifier holding the builder, which the caller resolves.
     *
     * `.subQuery()` opens a nested builder with its own alias scope, so the walk
     * stops there rather than attributing inner joins to the outer builder.
     */
    function chainRoot(expressionRaw: TSESTree.Node): TSESTree.Node | null {
      let current: TSESTree.Node = unwrapChain(expressionRaw);

      while (true) {
        if (current.type === AST_NODE_TYPES.CallExpression) {
          if (isCreateQueryBuilderCall(current)) {
            return current;
          }

          const callee = current.callee;

          if (callee.type !== AST_NODE_TYPES.MemberExpression) {
            return null;
          }

          if (
            callee.property.type === AST_NODE_TYPES.Identifier &&
            callee.property.name === 'subQuery'
          ) {
            return null;
          }

          current = unwrapChain(callee.object);
          continue;
        }

        if (current.type === AST_NODE_TYPES.MemberExpression) {
          current = unwrapChain(current.object);
          continue;
        }

        return current;
      }
    }

    function findOriginForIdentifier(
      node: TSESTree.Identifier,
    ): TSESTree.CallExpression | null {
      const variable = findVariable(
        context.sourceCode.getScope(node),
        node.name,
      );
      const def = variable?.defs[0];

      if (def?.node.type !== AST_NODE_TYPES.VariableDeclarator) {
        return null;
      }

      return def.node.init ? findReceiverOrigin(def.node.init) : null;
    }

    /**
     * A chain may be written inline off `createQueryBuilder`, or off a local
     * holding the builder — and in the latter case every join past the first has
     * a *call* as its receiver, not the identifier, so the walk has to reach the
     * bottom before resolving.
     */
    function findReceiverOrigin(
      receiver: TSESTree.Node,
    ): TSESTree.CallExpression | null {
      const unwrapped = unwrapChain(receiver);
      const cached = originCache.get(unwrapped);

      if (cached !== undefined) {
        return cached;
      }

      // Guards against a self-referential declarator (`const qb = qb.join(…)`).
      originCache.set(unwrapped, null);

      const root = chainRoot(unwrapped);
      let result: TSESTree.CallExpression | null = null;

      if (root?.type === AST_NODE_TYPES.CallExpression) {
        result = root;
      } else if (root?.type === AST_NODE_TYPES.Identifier) {
        result = findOriginForIdentifier(root);
      }

      originCache.set(unwrapped, result);

      return result;
    }

    /** Strips `Array<>`, `Promise<>` and `| null | undefined` down to the entity. */
    function unwrapRelationTarget(type: Type): Type | null {
      let current: Type | null = type;

      for (let depth = 0; current && depth < MAX_HERITAGE_DEPTH; depth++) {
        if (current.isUnionType()) {
          const meaningful: Type[] = (current as UnionOrIntersectionType).getTypes().filter(
            (part) => (part.flags & (TypeFlags.Null | TypeFlags.Undefined)) === 0,
          );

          if (meaningful.length !== 1) {
            return null;
          }

          current = meaningful[0]!;
          continue;
        }

        const symbolName = current.getSymbol()?.name;

        if ((symbolName === 'Array' || symbolName === 'Promise') && (current.flags & TypeFlags.Object) !== 0) {
          const args: readonly Type[] = checker.getTypeArguments(current as TypeReference);

          current = args[0] ?? null;
          continue;
        }

        return current;
      }

      return null;
    }

    function entityName(type: Type): string {
      return type.getSymbol()?.name ?? checker.typeToString(type);
    }

    function isRelationProperty(symbol: TsSymbol): boolean {
      for (const handle of symbol.declarations) {
        const decl = handle.resolve() as { modifiers?: readonly Parameters<typeof isDecorator>[0][] };

        for (const decorator of decl.modifiers ?? []) {
          if (!isDecorator(decorator) || !isCallExpression(decorator.expression)) {
            continue;
          }

          const callee = decorator.expression.expression;
          const name = isIdentifier(callee) ? callee.text : isPropertyAccessExpression(callee) ? callee.name.text : undefined;

          if (name && RELATION_DECORATORS.has(name)) {
            return true;
          }
        }
      }

      return false;
    }

    /**
     * True when the declaring file cannot carry decorators at all — a `.d.ts`
     * strips them, so "no relation decorator" there means "unknown", never
     * "not a relation".
     */
    function decoratorsAreObservable(symbol: TsSymbol): boolean {
      const declarations = symbol.declarations;

      return declarations.length > 0 && declarations.every((decl) => !decl.path.endsWith('.d.ts'));
    }

    // --- collection -------------------------------------------------------

    const candidates: Array<{ origin: TSESTree.CallExpression; join: IJoinCall }> = [];

    function collect(node: TSESTree.CallExpression): void {
      const callee = node.callee;

      if (
        callee.type !== AST_NODE_TYPES.MemberExpression ||
        callee.computed ||
        callee.property.type !== AST_NODE_TYPES.Identifier
      ) {
        return;
      }

      const method = callee.property.name;
      const isMap = MAP_JOINS.has(method);

      if (!isMap && !PATH_FIRST_JOINS.has(method)) {
        return;
      }

      const origin = findReceiverOrigin(callee.object);

      if (!origin) {
        return;
      }

      candidates.push({
        origin,
        join: {
          node,
          method,
          pathArgument: isMap ? node.arguments[1] : node.arguments[0],
          aliasArgument: isMap ? node.arguments[2] : node.arguments[1],
          mapArgument: isMap ? node.arguments[0] : undefined,
          receiver: callee.object,
        },
      });
    }

    // --- verification -----------------------------------------------------

    /**
     * Resolves the entity a join lands on, so a later join off its alias can be
     * checked. Returns null for shapes the rule does not follow — a raw table
     * name or a subquery — which registers the alias as known-but-opaque.
     */
    function resolveJoinTarget(
      join: IJoinCall,
      aliases: Map<string, IAliasEntry>,
    ): Type | null {
      const path = literalString(join.pathArgument);

      if (path === null) {
        // An entity class (`leftJoin(UserEntity, 'u')`) still yields a type.
        const argument = join.pathArgument;

        if (argument && argument.type === AST_NODE_TYPES.Identifier) {
          const construct = typeAt(argument).getConstructSignatures();

          return construct[0]?.getReturnType() ?? null;
        }

        return null;
      }

      const separator = path.indexOf('.');

      if (separator === -1) {
        return null; // raw table name
      }

      const sourceAlias = path.slice(0, separator);
      const property = path.slice(separator + 1);
      const source = aliases.get(sourceAlias);

      if (!source?.entityType || property.includes('.')) {
        return null;
      }

      const symbol = checker.getPropertyOfType(source.entityType, property);

      if (!symbol) {
        return null;
      }

      if (symbol.declarations.length === 0) {
        return null;
      }

      return unwrapRelationTarget(checker.getTypeOfSymbol(symbol));
    }

    function checkMapProperty(
      join: IJoinCall,
      aliases: Map<string, IAliasEntry>,
    ): void {
      const raw = literalString(join.mapArgument);

      if (raw === null) {
        return;
      }

      const separator = raw.indexOf('.');

      if (separator === -1) {
        return;
      }

      const alias = raw.slice(0, separator);
      const property = raw.slice(separator + 1);
      const entry = aliases.get(alias);

      // `mapToProperty` may name any declared field — mapping onto a
      // non-relation property is the entire point of the *AndMap* joins — so
      // only its existence is checked, never its decoration.
      if (!entry?.entityType || property.includes('.')) {
        return;
      }

      if (!checker.getPropertyOfType(entry.entityType, property)) {
        context.report({
          node: join.mapArgument!,
          messageId: 'unknownMapProperty',
          data: { property, entity: entityName(entry.entityType) },
        });
      }
    }

    function checkPath(join: IJoinCall, aliases: Map<string, IAliasEntry>): void {
      const path = literalString(join.pathArgument);

      if (path === null) {
        return;
      }

      const separator = path.indexOf('.');

      if (separator === -1) {
        return; // raw table name — nothing to resolve against
      }

      const sourceAlias = path.slice(0, separator);
      const property = path.slice(separator + 1);
      const entry = aliases.get(sourceAlias);

      if (!entry) {
        context.report({
          node: join.pathArgument!,
          messageId: 'unknownAlias',
          data: {
            alias: sourceAlias,
            available: [...aliases.keys()].map((a) => `'${a}'`).join(', '),
          },
        });

        return;
      }

      // Embedded/nested paths (`user.profile.city`) are left to TypeORM.
      if (!entry.entityType || property.includes('.')) {
        return;
      }

      const symbol = checker.getPropertyOfType(entry.entityType, property);

      if (!symbol) {
        context.report({
          node: join.pathArgument!,
          messageId: 'unknownProperty',
          data: { property, entity: entityName(entry.entityType) },
        });

        return;
      }

      if (decoratorsAreObservable(symbol) && !isRelationProperty(symbol)) {
        context.report({
          node: join.pathArgument!,
          messageId: 'notARelation',
          data: { property, entity: entityName(entry.entityType) },
        });
      }
    }

    function verifyChain(
      origin: TSESTree.CallExpression,
      joins: IJoinCall[],
    ): void {
      const rootAlias = literalString(origin.arguments[0]);

      if (rootAlias === null) {
        return; // aliasless createQueryBuilder() — nothing anchors the table
      }

      const rootEntity = queryBuilderEntity(typeAt(origin));

      if (!rootEntity) {
        return;
      }

      const aliases = new Map<string, IAliasEntry>([
        [rootAlias, { entityType: rootEntity }],
      ]);

      // Source order is what TypeORM sees: an alias is usable only after the
      // join that introduces it has run.
      for (const join of [...joins].sort(
        (a, b) => a.node.range[0] - b.node.range[0],
      )) {
        checkMapProperty(join, aliases);
        checkPath(join, aliases);

        const newAlias = literalString(join.aliasArgument);

        if (newAlias !== null) {
          aliases.set(newAlias, {
            entityType: resolveJoinTarget(join, aliases),
          });
        }
      }
    }

    return {
      'CallExpression:exit': collect,
      'Program:exit'(): void {
        if (candidates.length === 0) {
          return;
        }

        const fileTypes = typesFor(context);

        if (fileTypes === undefined) {
          return;
        }

        types = fileTypes;
        checker = fileTypes.checker;

        // A look-alike with its own `leftJoin` must not be linted: keep the joins called on a TypeORM builder.
        const receiverTypes = checker.getTypeAtLocation(candidates.map(({ join }) => types.nodeFor(join.receiver)));
        const chains = new Map<TSESTree.CallExpression, IJoinCall[]>();

        candidates.forEach(({ origin, join }, index) => {
          const receiverType = receiverTypes[index];

          if (receiverType !== undefined && queryBuilderEntity(receiverType)) {
            chains.set(origin, [...(chains.get(origin) ?? []), join]);
          }
        });

        for (const [origin, joins] of chains) {
          verifyChain(origin, joins);
        }
      },
    };
  },
});
