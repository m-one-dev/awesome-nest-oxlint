import type { TSESTree } from '@typescript-eslint/types';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import type { Expression } from 'tsrs/ast';
import { type Checker, type Type, TypeFlags, type UnionOrIntersectionType } from 'tsrs/sync';

import { typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

type MessageIds = 'implicitEnumToString';

// ---------------------------------------------------------------------------
// type classification
// ---------------------------------------------------------------------------

/** A union's constituents, or the type itself. */
function partsOf(type: Type): readonly Type[] {
  return (type.flags & TypeFlags.Union) === 0 ? [type] : (type as UnionOrIntersectionType).getTypes();
}

/**
 * True when `type` is a string-enum type or a string-enum member type — i.e.
 * every constituent is an enum literal whose value is a string. This matches:
 *   - a single member:           A.name           (EnumLiteral | StringLiteral)
 *   - a whole string enum:       A.name | A.other (union of the above)
 *   - the string member of a mixed enum: M.b
 * It deliberately rejects:
 *   - numeric enum members (NumberLiteral, not assignable to `string` anyway)
 *   - plain string-literal unions like `'a' | 'b'` (no EnumLiteral flag)
 *   - the bare `string` primitive
 */
function isStringEnumType(type: Type): boolean {
  // A non-union type that is not an enum literal needs no further request.
  if ((type.flags & (TypeFlags.Union | TypeFlags.EnumLiteral)) === 0) {
    return false;
  }

  return partsOf(type).every(
    (part) => (part.flags & TypeFlags.EnumLiteral) !== 0 && (part.flags & TypeFlags.StringLiteral) !== 0,
  );
}

/**
 * True when the only reason the string enum is accepted by `contextual` is a
 * bare `string` constituent — i.e. the enum is being implicitly widened to
 * `string`. Returns false when the sink has no bare-`string` part (e.g. it is
 * typed as the enum itself, `unknown`, or `any`) or when some non-`string`
 * constituent already accepts the enum.
 *
 * Note: `string | SomeEnum` cannot reach here as a distinct type — because a
 * string enum is a subtype of `string`, TypeScript collapses `string | A` to
 * `string`. The opt-out is therefore to type the sink as the enum itself.
 */
function isLaunderedThroughString(checker: Checker, enumType: Type, contextual: Type): boolean {
  const parts = partsOf(contextual);
  const nonStringParts = parts.filter((part) => (part.flags & TypeFlags.String) === 0);

  if (nonStringParts.length === parts.length) {
    return false;
  }

  return !nonStringParts.some((part) => checker.isTypeAssignableTo(enumType, part));
}

/**
 * Skip identifiers that are not standalone value expressions — a property name
 * (`A.name` → `name`), an object-literal key (`{ name: x }` → `name`), a
 * type-position or declaration name, an import or export binding. These have no
 * contextual type of their own, and TypeScript's contextual-type query is only
 * defined for expressions.
 */
const NON_VALUE_PARENTS = new Set<string>([
  AST_NODE_TYPES.TSTypeReference,
  AST_NODE_TYPES.TSQualifiedName,
  AST_NODE_TYPES.TSTypeQuery,
  AST_NODE_TYPES.TSImportType,
  AST_NODE_TYPES.TSEnumDeclaration,
  AST_NODE_TYPES.TSEnumMember,
  AST_NODE_TYPES.TSInterfaceDeclaration,
  AST_NODE_TYPES.TSTypeAliasDeclaration,
  AST_NODE_TYPES.TSModuleDeclaration,
  AST_NODE_TYPES.TSPropertySignature,
  AST_NODE_TYPES.TSMethodSignature,
  AST_NODE_TYPES.TSTypeParameter,
  AST_NODE_TYPES.TSIndexedAccessType,
  AST_NODE_TYPES.TSClassImplements,
  AST_NODE_TYPES.TSInterfaceHeritage,
  AST_NODE_TYPES.ImportSpecifier,
  AST_NODE_TYPES.ImportDefaultSpecifier,
  AST_NODE_TYPES.ImportNamespaceSpecifier,
  AST_NODE_TYPES.ExportSpecifier,
  AST_NODE_TYPES.LabeledStatement,
  AST_NODE_TYPES.BreakStatement,
  AST_NODE_TYPES.ContinueStatement,
  // `import` and `meta` in `import.meta` are keywords to TypeScript, not nodes it can be asked about.
  AST_NODE_TYPES.MetaProperty,
]);

function isNonReferenceIdentifier(node: TSESTree.Identifier): boolean {
  const parent = node.parent;

  if (NON_VALUE_PARENTS.has(parent.type)) {
    return true;
  }
  if (parent.type === AST_NODE_TYPES.MemberExpression && parent.property === node && !parent.computed) {
    return true;
  }
  if (
    (parent.type === AST_NODE_TYPES.Property ||
      parent.type === AST_NODE_TYPES.PropertyDefinition ||
      parent.type === AST_NODE_TYPES.MethodDefinition ||
      parent.type === AST_NODE_TYPES.TSAbstractPropertyDefinition ||
      parent.type === AST_NODE_TYPES.TSAbstractMethodDefinition) &&
    parent.key === node &&
    !parent.computed
  ) {
    return true;
  }

  return false;
}

/**
 * True for syntactic positions that can never be a string sink: a callee is
 * consumed as a function, a member-access receiver as an object — neither has
 * a bare-`string` contextual type. Computed keys (`record[x]`) are the
 * `property`, not the `object`, so genuine index sinks are still checked.
 */
function isNeverSinkPosition(node: TSESTree.Expression): boolean {
  const parent = node.parent;

  if ((parent.type === AST_NODE_TYPES.CallExpression || parent.type === AST_NODE_TYPES.NewExpression) && parent.callee === node) {
    return true;
  }

  return parent.type === AST_NODE_TYPES.MemberExpression && parent.object === node;
}

// ---------------------------------------------------------------------------
// rule
// ---------------------------------------------------------------------------

export const noImplicitEnumToString = createRule<[], MessageIds>({
  name: 'no-implicit-enum-to-string',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Bans implicitly passing a string enum where a plain `string` is expected. Type the target as the enum, or convert explicitly with String(...).',
    },
    messages: {
      implicitEnumToString:
        "Implicitly using the string enum '{{enumType}}' where a 'string' is expected widens it to its raw value and decouples this code from the enum. Type the target as the enum, convert explicitly with String(...), or disable this rule with a reason.",
    },
    schema: [],
    defaultOptions: [],
  },
  create(context) {
    const candidates: TSESTree.Expression[] = [];

    function collect(node: TSESTree.Expression): void {
      if (!isNeverSinkPosition(node)) {
        candidates.push(node);
      }
    }

    return {
      MemberExpression: collect,
      CallExpression: collect,
      Identifier(node): void {
        if (!isNonReferenceIdentifier(node)) {
          collect(node);
        }
      },
      // Types are asked for once per file, in one request, when the file's nodes are all known.
      'Program:exit'(): void {
        if (candidates.length === 0) {
          return;
        }

        const types = typesFor(context);

        if (types === undefined) {
          return;
        }

        const { checker } = types;
        const tsNodes = candidates.map((node) => types.nodeFor(node));
        const nodeTypes = checker.getTypeAtLocation(tsNodes);

        candidates.forEach((node, index) => {
          const enumType = nodeTypes[index];

          if (enumType === undefined || !isStringEnumType(enumType)) {
            return;
          }

          const contextual = checker.getContextualType(tsNodes[index] as Expression);

          if (contextual === undefined || !isLaunderedThroughString(checker, enumType, contextual)) {
            return;
          }

          context.report({
            node,
            messageId: 'implicitEnumToString',
            data: { enumType: checker.typeToString(enumType) },
          });
        });
      },
    };
  },
});
