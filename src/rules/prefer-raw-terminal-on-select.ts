import type { TSESTree } from '@typescript-eslint/types';
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

type MessageIds =
  | 'useRawTerminal'
  | 'requireGeneric'
  | 'semanticTerminalNeedsManualRewrite';

const SAFE_REWRITE_MAP: ReadonlyMap<string, string> = new Map([
  ['getOne', 'getRawOne'],
  ['getMany', 'getRawMany'],
]);

const SUGGEST_ONLY_TERMINALS: ReadonlySet<string> = new Set([
  'getOneOrFail',
  'getManyAndCount',
]);

const RAW_TERMINALS: ReadonlySet<string> = new Set(['getRawOne', 'getRawMany']);

const ALL_FLAGGED_TERMINALS: ReadonlySet<string> = new Set<string>([
  ...SAFE_REWRITE_MAP.keys(),
  ...SUGGEST_ONLY_TERMINALS,
  ...RAW_TERMINALS,
]);

const QB_TYPE_NAMES: ReadonlySet<string> = new Set([
  'SelectQueryBuilder',
  'QueryBuilder',
]);

const MAX_HERITAGE_DEPTH = 15;

interface QbInfo {
  isQb: boolean;
}

interface ChainAnalysis {
  hasSelect: boolean;
  hasCreateQueryBuilder: boolean;
  rootIdentifier: TSESTree.Identifier | null;
}

export const preferRawTerminalOnSelect = createRule<[], MessageIds>({
  name: 'prefer-raw-terminal-on-select',
  meta: {
    type: 'problem',
    fixable: 'code',
    hasSuggestions: false,
    docs: {
      description:
        'When a TypeORM SelectQueryBuilder chain calls .select / .addSelect, force the terminal to be getRawOne / getRawMany with an explicit generic type argument. Hydrated terminals (getOne, getMany, ...) return mismatched shapes for projected rows.',
    },
    messages: {
      useRawTerminal:
        "'{{method}}' on a SelectQueryBuilder after .select / .addSelect is not allowed. Use '{{rawMethod}}<{}>()' instead.",
      requireGeneric:
        "'{{method}}' after .select / .addSelect requires an explicit generic type argument, e.g. '{{method}}<{}>()'.",
      semanticTerminalNeedsManualRewrite:
        "'{{method}}' after .select / .addSelect changes raw-row semantics; rewrite manually to getRawOne / getRawMany or getRawAndEntities.",
    },
    schema: [],
    defaultOptions: [],
  },
  create(context) {
    // TypeScript's checker for this file, asked for once the whole file has been walked.
    let checker: Checker;
    const sourceCode = context.sourceCode;

    function symbolIsFromTypeorm(symbol: TsSymbol | undefined): boolean {
      if (!symbol) return false;
      const visited = new Set<number>();
      const stack: TsSymbol[] = [symbol];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || visited.has(cur.id)) continue;
        visited.add(cur.id);
        if (
          cur.declarations.some((decl) => /[\\/]typeorm[\\/]/.test(decl.path))
        ) {
          return true;
        }
        if ((cur.flags & SymbolFlags.Alias) !== 0) {
          const aliased = checker.getAliasedSymbol(cur);
          if (aliased.id !== cur.id) stack.push(aliased);
        }
      }
      return false;
    }

    function analyzeReceiverType(type: Type): QbInfo {
      const seen = new Set<number>();
      const stack: Array<{ type: Type; depth: number }> = [{ type, depth: 0 }];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || seen.has(cur.type.id)) continue;
        seen.add(cur.type.id);
        if (cur.depth > MAX_HERITAGE_DEPTH) continue;
        if (cur.type.isUnionType() || cur.type.isIntersectionType()) {
          for (const t of (cur.type as UnionOrIntersectionType).getTypes()) {
            stack.push({ type: t, depth: cur.depth + 1 });
          }
          continue;
        }
        const symbol = cur.type.getSymbol() ?? cur.type.getAliasSymbol();
        const name = symbol?.name;
        if (name && QB_TYPE_NAMES.has(name) && symbolIsFromTypeorm(symbol)) {
          return { isQb: true };
        }
        for (const base of cur.type.getBaseTypes() ?? []) {
          stack.push({ type: base, depth: cur.depth + 1 });
        }
      }
      return { isQb: false };
    }

    function unwrap(node: TSESTree.Node): TSESTree.Node {
      switch (node.type) {
        case AST_NODE_TYPES.ChainExpression:
          return unwrap(node.expression);
        case AST_NODE_TYPES.AwaitExpression:
          return unwrap(node.argument);
        case AST_NODE_TYPES.TSNonNullExpression:
          return unwrap(node.expression);
        case AST_NODE_TYPES.TSAsExpression:
          return unwrap(node.expression);
        case AST_NODE_TYPES.TSTypeAssertion:
          return unwrap(node.expression);
        default:
          return node;
      }
    }

    function analyzeChain(terminal: TSESTree.CallExpression): ChainAnalysis {
      const result: ChainAnalysis = {
        hasSelect: false,
        hasCreateQueryBuilder: false,
        rootIdentifier: null,
      };
      const callee = terminal.callee;
      if (callee.type !== AST_NODE_TYPES.MemberExpression) return result;
      let cur: TSESTree.Node = unwrap(callee.object);
      while (true) {
        if (cur.type === AST_NODE_TYPES.CallExpression) {
          const innerCallee = cur.callee;
          if (
            innerCallee.type === AST_NODE_TYPES.MemberExpression &&
            !innerCallee.computed &&
            innerCallee.property.type === AST_NODE_TYPES.Identifier
          ) {
            const name = innerCallee.property.name;
            if (name === 'select' || name === 'addSelect') {
              result.hasSelect = true;
            }
            if (name === 'createQueryBuilder') {
              result.hasCreateQueryBuilder = true;
              return result;
            }
            cur = unwrap(innerCallee.object);
            continue;
          }
          return result;
        }
        if (cur.type === AST_NODE_TYPES.Identifier) {
          result.rootIdentifier = cur;
          return result;
        }
        return result;
      }
    }

    function variableHasPriorSelect(
      identifier: TSESTree.Identifier,
      beforeStart: number,
    ): boolean {
      const scope = sourceCode.getScope(identifier);
      const variable = findVariable(scope, identifier.name);
      if (!variable) return false;
      for (const ref of variable.references) {
        const refNode = ref.identifier as TSESTree.Identifier;
        if (refNode.range[0] >= beforeStart) continue;
        const parent = refNode.parent;
        if (!parent || parent.type !== AST_NODE_TYPES.MemberExpression)
          continue;
        if (parent.computed) continue;
        if (parent.object !== refNode) continue;
        if (parent.property.type !== AST_NODE_TYPES.Identifier) continue;
        const grand = parent.parent;
        if (!grand || grand.type !== AST_NODE_TYPES.CallExpression) continue;
        if (grand.callee !== parent) continue;
        const name = parent.property.name;
        if (name === 'select' || name === 'addSelect') return true;
      }
      return false;
    }

    /**
     * A flagged terminal whose chain selects; `needsType` when only its
     * receiver's type can say the builder is TypeORM's.
     */
    const candidates: Array<{
      node: TSESTree.CallExpression;
      callee: TSESTree.MemberExpression & { property: TSESTree.Identifier };
      method: string;
      needsType: boolean;
    }> = [];

    function report(
      callee: TSESTree.MemberExpression & { property: TSESTree.Identifier },
      method: string,
    ): void {
      if (RAW_TERMINALS.has(method)) {
        context.report({
          node: callee.property,
          messageId: 'requireGeneric',
          data: { method },
          *fix(fixer) {
            yield fixer.insertTextAfter(callee.property, '<{}>');
          },
        });
        return;
      }

      if (SUGGEST_ONLY_TERMINALS.has(method)) {
        context.report({
          node: callee.property,
          messageId: 'semanticTerminalNeedsManualRewrite',
          data: { method },
        });
        return;
      }

      const rawMethod = SAFE_REWRITE_MAP.get(method);
      if (!rawMethod) return;
      context.report({
        node: callee.property,
        messageId: 'useRawTerminal',
        data: { method, rawMethod },
        *fix(fixer) {
          yield fixer.replaceText(callee.property, `${rawMethod}<{}>`);
        },
      });
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier
        ) {
          return;
        }
        const method = callee.property.name;
        if (!ALL_FLAGGED_TERMINALS.has(method)) return;

        const chain = analyzeChain(node);
        let hasSelect = chain.hasSelect;
        if (!hasSelect && chain.rootIdentifier) {
          hasSelect = variableHasPriorSelect(
            chain.rootIdentifier,
            node.range[0],
          );
        }
        if (!hasSelect) return;
        // A raw terminal with its generic is already what the rule asks for.
        if (RAW_TERMINALS.has(method) && node.typeArguments) return;

        candidates.push({
          node,
          callee: callee as TSESTree.MemberExpression & {
            property: TSESTree.Identifier;
          },
          method,
          // A chain rooted in createQueryBuilder is a builder whatever its type says.
          needsType: !chain.hasCreateQueryBuilder,
        });
      },
      // Types are asked for once per file, in one request, when the file's terminals are all known.
      'Program:exit'(): void {
        if (candidates.length === 0) return;

        const typed = candidates.filter(({ needsType }) => needsType);
        // A file in no program still gets the findings its syntax decides: a chain rooted in createQueryBuilder.
        const types = typed.length === 0 ? undefined : typesFor(context);
        const builders = new Set<TSESTree.CallExpression>();

        if (types !== undefined) {
          checker = types.checker;
          const receiverTypes = checker.getTypeAtLocation(
            typed.map(({ callee }) => types.nodeFor(callee.object)),
          );
          typed.forEach(({ node }, index) => {
            const receiverType = receiverTypes[index];
            if (
              receiverType !== undefined &&
              analyzeReceiverType(receiverType).isQb
            ) {
              builders.add(node);
            }
          });
        }

        for (const { node, callee, method, needsType } of candidates) {
          if (!needsType || builders.has(node)) {
            report(callee, method);
          }
        }
      },
    };
  },
});
