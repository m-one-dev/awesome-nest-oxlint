import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import {
  type Checker,
  type Symbol as TsSymbol,
  SymbolFlags,
  type Type,
  type UnionOrIntersectionType,
} from 'tsrs/sync';

import { typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';
import { findVariable } from '../utils/find-variable.js';

type MessageIds = 'tooManyJoins';

export type MaxTypeormJoinsOptions = { max?: number };

type Options = [MaxTypeormJoinsOptions];

const DEFAULT_MAX = 3;

const JOIN_METHODS: ReadonlySet<string> = new Set([
  'leftJoin',
  'innerJoin',
  'leftJoinAndSelect',
  'innerJoinAndSelect',
  'leftJoinAndMapOne',
  'leftJoinAndMapMany',
  'innerJoinAndMapOne',
  'innerJoinAndMapMany',
]);

const QUERY_BUILDER_TYPE_NAMES: ReadonlySet<string> = new Set([
  'SelectQueryBuilder',
  'QueryBuilder',
]);

const MAX_HERITAGE_DEPTH = 15;

export const maxTypeormJoins = createRule<Options, MessageIds>({
  name: 'max-typeorm-joins',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Limits the number of join methods on a single TypeORM QueryBuilder chain. See the typeorm-query skill.',
    },
    messages: {
      tooManyJoins:
        'TypeORM query exceeds the join limit ({{count}} > {{max}}). Reduce joins, split the query, or restructure. See the typeorm-query skill.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          max: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ max: DEFAULT_MAX }],
  },
  create(context, [option]): TSESLint.RuleListener {
    const max = option?.max ?? DEFAULT_MAX;
    // TypeScript's checker for this file, asked for once the whole file has been walked.
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
        if (
          current.declarations.some((decl) =>
            /[\\/]typeorm[\\/]/.test(decl.path),
          )
        ) {
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

    // Many joins share one builder type; each type is walked once per file.
    const isQueryBuilderCache = new Map<number, boolean>();

    function isQueryBuilderType(type: Type): boolean {
      const cached = isQueryBuilderCache.get(type.id);
      if (cached !== undefined) {
        return cached;
      }
      const result = walkForQueryBuilder(type);
      isQueryBuilderCache.set(type.id, result);
      return result;
    }

    function walkForQueryBuilder(type: Type): boolean {
      const seen = new Set<number>();
      const stack: Array<{ type: Type; depth: number }> = [{ type, depth: 0 }];
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
          for (const sub of (
            current.type as UnionOrIntersectionType
          ).getTypes()) {
            stack.push({ type: sub, depth: current.depth + 1 });
          }
          continue;
        }
        const symbol =
          current.type.getSymbol() ?? current.type.getAliasSymbol();
        const name = symbol?.name;
        if (
          name &&
          QUERY_BUILDER_TYPE_NAMES.has(name) &&
          symbolIsFromTypeorm(symbol)
        ) {
          return true;
        }
        const bases = current.type.getBaseTypes() ?? [];
        for (const base of bases) {
          stack.push({ type: base, depth: current.depth + 1 });
        }
      }
      return false;
    }

    function unwrapChain(node: TSESTree.Node): TSESTree.Node {
      if (node.type === AST_NODE_TYPES.ChainExpression) {
        return node.expression;
      }
      return node;
    }

    function isCreateQueryBuilderCall(node: TSESTree.Node): boolean {
      if (node.type !== AST_NODE_TYPES.CallExpression) {
        return false;
      }
      const callee = node.callee;
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return false;
      }
      if (
        callee.property.type !== AST_NODE_TYPES.Identifier ||
        callee.property.name !== 'createQueryBuilder'
      ) {
        return false;
      }
      return true;
    }

    const originCache = new WeakMap<
      TSESTree.Node,
      TSESTree.CallExpression | null
    >();

    // Walks down to whatever the chain is rooted in: the createQueryBuilder call
    // when it is inline, otherwise the deepest node — usually the identifier
    // holding the builder, which the caller resolves.
    // .subQuery() opens a nested builder scope; stop the inward walk there so
    // joins inside subqueries aren't attributed to the outer createQueryBuilder.
    function chainRoot(exprRaw: TSESTree.Node): TSESTree.Node | null {
      let current: TSESTree.Node = unwrapChain(exprRaw);
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
      const scope = context.sourceCode.getScope(node);
      const variable = findVariable(scope, node.name);
      if (!variable) {
        return null;
      }
      const def = variable.defs[0];
      if (!def) {
        return null;
      }
      if (def.node.type !== AST_NODE_TYPES.VariableDeclarator) {
        return null;
      }
      const init = def.node.init;
      if (!init) {
        return null;
      }
      return findReceiverOrigin(init);
    }

    // A chain may be written inline off createQueryBuilder, or off a local
    // holding the builder — and in the latter case every join past the first has
    // a *call* as its receiver, not the identifier, so the walk has to reach the
    // bottom before resolving. Resolving only an immediate identifier receiver
    // counts the first join of such a chain and silently drops the rest.
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

    // Joins in the order their calls exit, which is source order along a chain.
    const candidates: Array<{
      origin: TSESTree.CallExpression;
      receiver: TSESTree.Node;
      reportNode: TSESTree.Node;
    }> = [];
    const joinCounts = new Map<TSESTree.CallExpression, number>();

    function recordJoin(
      origin: TSESTree.CallExpression,
      reportNode: TSESTree.Node,
    ): void {
      const count = (joinCounts.get(origin) ?? 0) + 1;
      joinCounts.set(origin, count);
      if (count === max + 1) {
        context.report({
          node: reportNode,
          messageId: 'tooManyJoins',
          data: { count, max },
        });
      }
    }

    return {
      'CallExpression:exit'(node: TSESTree.CallExpression): void {
        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier
        ) {
          return;
        }
        if (!JOIN_METHODS.has(callee.property.name)) {
          return;
        }
        const origin = findReceiverOrigin(callee.object);
        if (!origin) {
          return;
        }
        candidates.push({
          origin,
          receiver: callee.object,
          reportNode: callee.property,
        });
      },
      // Types are asked for once per file, in one request, when the file's joins are all known.
      'Program:exit'(): void {
        if (candidates.length === 0) {
          return;
        }
        const types = typesFor(context);
        if (types === undefined) {
          return;
        }
        checker = types.checker;
        // A look-alike with its own `leftJoin` must not be counted: keep the
        // joins called on a TypeORM builder.
        const receiverTypes = checker.getTypeAtLocation(
          candidates.map(({ receiver }) => types.nodeFor(receiver)),
        );
        candidates.forEach(({ origin, reportNode }, index) => {
          const receiverType = receiverTypes[index];
          if (receiverType !== undefined && isQueryBuilderType(receiverType)) {
            recordJoin(origin, reportNode);
          }
        });
      },
    };
  },
});
