import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import { SymbolFlags, type Type } from 'tsrs/sync';

import { type IFileTypes, typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

type MessageIds = 'missingUseDto';

type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression;

const ABSTRACT_ENTITY_NAMES: ReadonlySet<string> = new Set([
  'AbstractEntity',
  'AbstractTranslationEntity',
]);

const ALLOWLISTED_NAMES: ReadonlySet<string> = new Set([
  'AbstractEntity',
  'AbstractTranslationEntity',
]);

const MAX_HERITAGE_DEPTH = 10;

function getDecoratorName(decorator: TSESTree.Decorator): string | null {
  const expr = decorator.expression;
  if (expr.type === AST_NODE_TYPES.Identifier) {
    return expr.name;
  }
  if (
    expr.type === AST_NODE_TYPES.CallExpression &&
    expr.callee.type === AST_NODE_TYPES.Identifier
  ) {
    return expr.callee.name;
  }
  return null;
}

function deriveDtoName(entityClassName: string): string {
  if (entityClassName.endsWith('Entity')) {
    return `${entityClassName.slice(0, -'Entity'.length)}Dto`;
  }
  return `${entityClassName}Dto`;
}

/**
 * The superclass expression TypeScript can name a symbol for: an identifier or
 * a dotted name. Anything else (a mixin call) has no symbol, so it never
 * reaches AbstractEntity.
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

export const requireUseDtoDecorator = createRule<[], MessageIds>({
  name: 'require-use-dto-decorator',
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        "Concrete classes extending AbstractEntity must have a '@UseDto(...)' decorator so 'entity.toDto()' resolves at runtime.",
    },
    messages: {
      missingUseDto:
        "Entity class '{{name}}' must have a '@UseDto({{dto}})' decorator. Without it, '.toDto()' throws at runtime.",
    },
    schema: [],
    defaultOptions: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    /** Concrete classes of this file with no @UseDto, in source order, with their superclass. */
    const candidates: Array<{ node: ClassNode; id: TSESTree.Identifier; superClass: TSESTree.Expression }> = [];

    function chainReachesAbstractEntity(startType: Type): boolean {
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
        if (name && ABSTRACT_ENTITY_NAMES.has(name)) {
          return true;
        }
        const bases = current.type.getBaseTypes() ?? [];
        for (const base of bases) {
          stack.push({ type: base, depth: current.depth + 1 });
        }
      }
      return false;
    }

    /** Whether each superclass reaches AbstractEntity, asked of TypeScript in one request. */
    function reachesAbstractEntity(types: IFileTypes, superClasses: readonly TSESTree.Expression[]): boolean[] {
      const { checker } = types;
      const symbols = checker.getSymbolAtLocation(superClasses.map((node) => types.nodeFor(node)));
      // Most entities share a base, so each superclass symbol is resolved once.
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
          reaches = chainReachesAbstractEntity(checker.getDeclaredTypeOfSymbol(aliased));
          bySymbol.set(aliased.id, reaches);
        }
        return reaches;
      });
    }

    function check(node: ClassNode): void {
      if (!node.id) {
        return;
      }
      if (ALLOWLISTED_NAMES.has(node.id.name)) {
        return;
      }
      if (node.abstract) {
        return;
      }
      const superClass = namedSuperClass(node);
      if (!superClass) {
        return;
      }
      if ((node.decorators ?? []).some((d) => getDecoratorName(d) === 'UseDto')) {
        return;
      }
      candidates.push({ node, id: node.id, superClass });
    }

    function report(node: ClassNode, id: TSESTree.Identifier): void {
      const className = id.name;
      const decorators = node.decorators ?? [];
      const dtoName = deriveDtoName(className);

      context.report({
        node: id,
        messageId: 'missingUseDto',
        data: { name: className, dto: dtoName },
        fix(fixer): TSESLint.RuleFix {
          const insertionTarget = decorators[0] ?? node;
          const targetLine =
            sourceCode.lines[insertionTarget.loc.start.line - 1] ?? '';
          const indentMatch = /^\s*/.exec(targetLine);
          const indent = indentMatch ? indentMatch[0] : '';
          return fixer.insertTextBefore(
            insertionTarget,
            `@UseDto(${dtoName})\n${indent}`,
          );
        },
      });
    }

    return {
      [AST_NODE_TYPES.ClassDeclaration]: check,
      [AST_NODE_TYPES.ClassExpression]: check,
      // Types are asked for once per file, when every class in it is known.
      'Program:exit'(): void {
        if (candidates.length === 0) {
          return;
        }

        const types = typesFor(context);

        if (types === undefined) {
          return;
        }

        const reaches = reachesAbstractEntity(types, candidates.map(({ superClass }) => superClass));

        candidates.forEach(({ node, id }, index) => {
          if (reaches[index]) {
            report(node, id);
          }
        });
      },
    };
  },
});
