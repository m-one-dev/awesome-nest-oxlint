import type { TSESTree } from '@typescript-eslint/types';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import type { Expression } from 'tsrs/ast';

import { typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

type MessageIds = 'requireAnchor' | 'asInsteadOfSatisfies';

function isAsConst(asExpr: TSESTree.TSAsExpression): boolean {
  const typeAnn = asExpr.typeAnnotation;
  return (
    typeAnn.type === AST_NODE_TYPES.TSTypeReference &&
    typeAnn.typeName.type === AST_NODE_TYPES.Identifier &&
    typeAnn.typeName.name === 'const'
  );
}

export const requireObjectLiteralAnchor = createRule<[], MessageIds>({
  name: 'require-object-literal-anchor',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Object literals whose contextual type cannot be inferred must be anchored with 'satisfies T' or 'as const'. 'as T' is rejected because it allows unsafe widening — use 'satisfies T' instead.",
    },
    messages: {
      requireAnchor:
        "Object literal has no contextual type. TypeScript silently inferred an anonymous shape — anchor it with '{...} satisfies T' (or 'as const' for frozen literals) so the intended type is verified.",
      asInsteadOfSatisfies:
        "'{...} as T' allows unsafe widening to a wrong shape. Use '{...} satisfies T' so TypeScript verifies assignability without widening.",
    },
    schema: [],
    defaultOptions: [],
  },
  create(context) {
    // The literals whose contextual type is asked for once the whole file has been walked.
    const unanchored: TSESTree.ObjectExpression[] = [];

    return {
      ObjectExpression(node) {
        const parent = node.parent;

        if (parent?.type === AST_NODE_TYPES.TSAsExpression) {
          if (isAsConst(parent)) {
            return;
          }
          context.report({ node: parent, messageId: 'asInsteadOfSatisfies' });
          return;
        }

        if (parent?.type === AST_NODE_TYPES.TSSatisfiesExpression) {
          return;
        }

        unanchored.push(node);
      },
      'Program:exit'(): void {
        if (unanchored.length === 0) {
          return;
        }

        const types = typesFor(context);

        if (types === undefined) {
          return;
        }

        for (const node of unanchored) {
          const contextual = types.checker.getContextualType(
            types.nodeFor(node) as Expression,
          );

          if (contextual === undefined) {
            context.report({ node, messageId: 'requireAnchor' });
          }
        }
      },
    };
  },
});
