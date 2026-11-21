import type { TSESTree } from '@typescript-eslint/types';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import { SymbolFlags, type Type } from 'tsrs/sync';

import { type IFileTypes, typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

type MessageIds = 'mustExtend';

type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression;

const BASE_NAMES: ReadonlySet<string> = new Set(['AbstractDto', 'BaseDto']);

const ALLOWLISTED_NAMES: ReadonlySet<string> = new Set([
  'AbstractDto',
  'BaseDto',
  'TranslatableDto',
  'AbstractTranslationDto',
]);

const MAX_HERITAGE_DEPTH = 10;

/**
 * The superclass expression TypeScript can name a symbol for: an identifier or
 * a dotted name. Anything else (`PickType(...)`, a mixin call) has no symbol,
 * so it never reaches a base and is reported without asking for types.
 */
function namedSuperClass(node: ClassNode): TSESTree.Expression | null {
  const superClass = node.superClass;

  if (superClass?.type === AST_NODE_TYPES.Identifier) {
    return superClass;
  }

  if (superClass?.type === AST_NODE_TYPES.MemberExpression && !superClass.computed) {
    return superClass;
  }

  return null;
}

export const dtoMustExtendAbstractOrBase = createRule<[], MessageIds>({
  name: 'dto-must-extend-abstract-or-base',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Classes with names ending in 'Dto' must transitively extend AbstractDto or BaseDto.",
    },
    messages: {
      mustExtend:
        "Class '{{name}}' ends with 'Dto' and must extend AbstractDto or BaseDto (directly or transitively).",
    },
    schema: [],
    defaultOptions: [],
  },
  create(context) {
    /** The 'Dto' classes of this file, in source order, with the superclass whose type decides them. */
    const candidates: Array<{ id: TSESTree.Identifier; superClass: TSESTree.Expression | null }> = [];

    function chainReachesBase(startType: Type): boolean {
      const seen = new Set<number>();
      const stack: Array<{ type: Type; depth: number }> = [
        { type: startType, depth: 0 },
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
        const name = current.type.getSymbol()?.name;
        if (name && BASE_NAMES.has(name)) {
          return true;
        }
        const bases = current.type.getBaseTypes() ?? [];
        for (const base of bases) {
          stack.push({ type: base, depth: current.depth + 1 });
        }
      }
      return false;
    }

    /** Whether each named superclass reaches a base, asked of TypeScript in one request. */
    function reachesBase(types: IFileTypes, superClasses: readonly TSESTree.Expression[]): boolean[] {
      const { checker } = types;
      const symbols = checker.getSymbolAtLocation(superClasses.map((node) => types.nodeFor(node)));
      // Most DTOs share a base, so each superclass symbol is resolved once.
      const bySymbol = new Map<number, boolean>();

      return symbols.map((symbol) => {
        if (!symbol) {
          return false;
        }
        const aliased =
          (symbol.flags & SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        let reaches = bySymbol.get(aliased.id);
        if (reaches === undefined) {
          reaches = chainReachesBase(checker.getDeclaredTypeOfSymbol(aliased));
          bySymbol.set(aliased.id, reaches);
        }
        return reaches;
      });
    }

    function check(node: ClassNode): void {
      if (!node.id?.name.endsWith('Dto')) {
        return;
      }
      if (ALLOWLISTED_NAMES.has(node.id.name)) {
        return;
      }
      candidates.push({ id: node.id, superClass: namedSuperClass(node) });
    }

    return {
      [AST_NODE_TYPES.ClassDeclaration]: check,
      [AST_NODE_TYPES.ClassExpression]: check,
      // Types are asked for once per file, when every class in it is known.
      'Program:exit'(): void {
        const named = candidates.flatMap(({ superClass }) => (superClass ? [superClass] : []));
        const types = named.length > 0 ? typesFor(context) : undefined;
        const reaches = types ? reachesBase(types, named) : [];
        let namedIndex = 0;

        for (const { id, superClass } of candidates) {
          // Outside any program a named superclass cannot be followed, so it is not judged.
          if (superClass && reaches[namedIndex++] !== false) {
            continue;
          }

          context.report({
            node: id,
            messageId: 'mustExtend',
            data: { name: id.name },
          });
        }
      },
    };
  },
});
