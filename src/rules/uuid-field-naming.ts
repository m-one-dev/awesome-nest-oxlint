import type { TSESTree } from '@typescript-eslint/types';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import type { Expression } from 'tsrs/ast';
import {
  type Checker,
  type Symbol as TsSymbol,
  type Type,
  TypeFlags,
  type TypeReference,
  type UnionOrIntersectionType,
} from 'tsrs/sync';

import { typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

type MessageIds =
  | 'uuidFieldMustEndWithId'
  | 'uuidArrayFieldMustEndWithIds'
  | 'idSuffixRequiresUuid'
  | 'idsSuffixRequiresUuidArray';

export interface Options {
  enforceReverse?: boolean;
  allowNonUuidNames?: string[];
}

const BRAND_PROPERTY = '_uuidBrand';

const SINGULAR_NAME_RE = /^id$|[a-z0-9]Id$/;
const PLURAL_NAME_RE = /^ids$|[a-z0-9]Ids$/;

const SKIPPED_TYPE_FLAGS =
  TypeFlags.Undefined | TypeFlags.Null | TypeFlags.Void | TypeFlags.Never;

const OPAQUE_TYPE_FLAGS = TypeFlags.Any | TypeFlags.Unknown;

type TypeKind = 'uuid' | 'uuid-array' | 'opaque' | 'other';

/** A name checked against the type of `typeNode`. */
interface INameCheck {
  kind: 'name';
  reportTarget: TSESTree.Node;
  name: string;
  /**
   * Where the type is asked: the binding identifier, or the property itself.
   * A property is asked rather than its type annotation, since tsrs types the
   * name inside a type reference (`userId: Uuid`) as `any`; the two differ
   * only by the `undefined` a `?` adds, which classification strips.
   */
  typeNode: TSESTree.Node;
  /** A string-literal key (`'user-id'`): only the forward direction applies. */
  literalKey: boolean;
}

/** An object-literal property, checked against the property its contextual type declares. */
interface IObjectPropertyCheck {
  kind: 'objectProperty';
  key: TSESTree.Node;
  name: string;
  objectExpr: TSESTree.ObjectExpression;
}

export const uuidFieldNaming = createRule<[Options], MessageIds>({
  name: 'uuid-field-naming',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Field-like declarations whose type is the `Uuid` brand must end with `Id`; arrays of `Uuid` must end with `Ids`. Optional reverse direction enforces the inverse.',
    },
    messages: {
      uuidFieldMustEndWithId:
        "Field '{{name}}' has type Uuid and must end with 'Id'.",
      uuidArrayFieldMustEndWithIds:
        "Field '{{name}}' has type Uuid[] and must end with 'Ids'.",
      idSuffixRequiresUuid:
        "Field '{{name}}' ends with 'Id' but its type is not Uuid.",
      idsSuffixRequiresUuidArray:
        "Field '{{name}}' ends with 'Ids' but its type is not Uuid[].",
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          enforceReverse: { type: 'boolean' },
          allowNonUuidNames: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    ],
    defaultOptions: [{ enforceReverse: false, allowNonUuidNames: [] }],
  },
  create(context, [rawOptions]) {
    const enforceReverse = rawOptions.enforceReverse ?? false;
    const allowPatterns = (rawOptions.allowNonUuidNames ?? []).map(
      (p) => new RegExp(p),
    );
    // TypeScript's checker for this file, asked for once the whole file has been walked.
    let checker: Checker;

    function isAllowedNonUuid(name: string): boolean {
      return allowPatterns.some((re) => re.test(name));
    }

    function nameIsSingularIdSuffix(name: string): boolean {
      return SINGULAR_NAME_RE.test(name);
    }

    function nameIsPluralIdsSuffix(name: string): boolean {
      return PLURAL_NAME_RE.test(name);
    }

    function isPromiseType(type: Type): boolean {
      const symbol = type.getAliasSymbol() ?? type.getSymbol();
      return symbol?.name === 'Promise';
    }

    function isReadonlyWrapper(type: Type): Type | null {
      const aliasName = type.getAliasSymbol()?.name;
      if (aliasName === 'Readonly') {
        return type.getAliasTypeArguments()[0] ?? null;
      }
      return null;
    }

    // Every type is classified once per file: the same few types (`string`,
    // `Uuid`) recur across nearly every declaration, and each question about a
    // type is a request to tsrs.
    const brandCache = new Map<number, boolean>();
    const elementCache = new Map<number, Type | null>();
    const kindCache = new Map<number, TypeKind>();

    function typeHasUuidBrand(type: Type, depth = 0): boolean {
      if (depth > 0) return typeHasUuidBrandWorker(type, depth);
      let cached = brandCache.get(type.id);
      if (cached === undefined) {
        cached = typeHasUuidBrandWorker(type, depth);
        brandCache.set(type.id, cached);
      }
      return cached;
    }

    function typeHasUuidBrandWorker(type: Type, depth: number): boolean {
      if (depth > 6) return false;
      if (type.flags & SKIPPED_TYPE_FLAGS) return false;
      if (type.flags & OPAQUE_TYPE_FLAGS) return false;

      if (isPromiseType(type)) return false;

      const unwrappedReadonly = isReadonlyWrapper(type);
      if (unwrappedReadonly) {
        return typeHasUuidBrand(unwrappedReadonly, depth + 1);
      }

      if (type.isUnionType() || type.isIntersectionType()) {
        return (type as UnionOrIntersectionType)
          .getTypes()
          .some((t) => typeHasUuidBrand(t, depth + 1));
      }

      const apparent = checker.getApparentType(type);
      const brand = apparent.getProperty(BRAND_PROPERTY);
      return brand !== undefined;
    }

    function getArrayElementType(type: Type): Type | null {
      let cached = elementCache.get(type.id);
      if (cached === undefined) {
        cached = getArrayElementTypeWorker(type);
        elementCache.set(type.id, cached);
      }
      return cached;
    }

    function getArrayElementTypeWorker(type: Type): Type | null {
      if (checker.isArrayType(type) || checker.isTupleType(type)) {
        const args = checker.getTypeArguments(type as TypeReference);
        const first = args[0];
        if (first === undefined) return null;
        if (args.every((a) => a.id === first.id)) return first;
        // Heterogeneous tuple — only fold to a single type if all branches are Uuid
        return args.every((a) => typeHasUuidBrand(a)) ? first : null;
      }
      const aliasName = type.getAliasSymbol()?.name;
      if (aliasName === 'ReadonlyArray') {
        return type.getAliasTypeArguments()[0] ?? null;
      }
      return null;
    }

    function classifyType(type: Type): TypeKind {
      let cached = kindCache.get(type.id);
      if (cached === undefined) {
        cached = classifyTypeWorker(type);
        kindCache.set(type.id, cached);
      }
      return cached;
    }

    /**
     * Classifies a type as 'uuid' (single Uuid), 'uuid-array' (Uuid[] or
     * homogeneous Uuid tuple/ReadonlyArray), or 'other'. Walks unions so
     * `Uuid | undefined` stays 'uuid', and skips Promise wrappers.
     */
    function classifyTypeWorker(type: Type): TypeKind {
      if (type.flags & OPAQUE_TYPE_FLAGS) return 'opaque';
      if (isPromiseType(type)) return 'other';

      // Strip nullable union members for classification purposes.
      const meaningful = type.isUnionType()
        ? (type as UnionOrIntersectionType)
            .getTypes()
            .filter((t) => !(t.flags & SKIPPED_TYPE_FLAGS))
        : [type];

      if (meaningful.length === 0) return 'other';

      if (meaningful.some((t) => t.flags & OPAQUE_TYPE_FLAGS)) return 'opaque';

      const anyUuid = meaningful.some((t) => typeHasUuidBrand(t));
      if (anyUuid) return 'uuid';

      const allArrays = meaningful.every(
        (t) => getArrayElementType(t) !== null,
      );
      if (allArrays) {
        const anyUuidArray = meaningful.some((t) => {
          const el = getArrayElementType(t);
          return el !== null && typeHasUuidBrand(el);
        });
        if (anyUuidArray) return 'uuid-array';
      }

      return 'other';
    }

    function reportNode(
      node: TSESTree.Node,
      messageId: MessageIds,
      name: string,
    ): void {
      context.report({ node, messageId, data: { name } });
    }

    function checkNameForType(
      reportTarget: TSESTree.Node,
      name: string,
      type: Type,
    ): void {
      const kind = classifyType(type);
      if (kind === 'opaque') return;

      // Forward direction
      if (kind === 'uuid' && !nameIsSingularIdSuffix(name)) {
        reportNode(reportTarget, 'uuidFieldMustEndWithId', name);
        return;
      }
      if (kind === 'uuid-array' && !nameIsPluralIdsSuffix(name)) {
        reportNode(reportTarget, 'uuidArrayFieldMustEndWithIds', name);
        return;
      }

      // Reverse direction
      if (!enforceReverse) return;
      if (isAllowedNonUuid(name)) return;

      if (kind !== 'uuid' && nameIsSingularIdSuffix(name)) {
        // Don't double-flag when the plural pattern also matches (it can't:
        // singular regex requires final 'Id', plural requires final 'Ids').
        reportNode(reportTarget, 'idSuffixRequiresUuid', name);
        return;
      }
      if (kind !== 'uuid-array' && nameIsPluralIdsSuffix(name)) {
        reportNode(reportTarget, 'idsSuffixRequiresUuidArray', name);
      }
    }

    /** String-literal keys (e.g. 'user-id') get flagged when the type is Uuid. */
    function checkLiteralKeyForType(
      reportTarget: TSESTree.Node,
      name: string,
      type: Type,
    ): void {
      const kind = classifyType(type);
      if (kind === 'uuid') {
        reportNode(reportTarget, 'uuidFieldMustEndWithId', name);
      } else if (kind === 'uuid-array') {
        reportNode(reportTarget, 'uuidArrayFieldMustEndWithIds', name);
      }
    }

    function checkObjectPropertyType(
      { key, name }: IObjectPropertyCheck,
      propType: Type,
    ): void {
      const kind = classifyType(propType);
      if (kind === 'opaque') return;

      // Only forward-direction checks fire on contextually-typed object literals;
      // reverse direction over-fires here (every literal property named `userId`
      // would demand the contextual prop be Uuid even when the contract uses string).
      if (kind === 'uuid' && !nameIsSingularIdSuffix(name)) {
        reportNode(key, 'uuidFieldMustEndWithId', name);
      } else if (kind === 'uuid-array' && !nameIsPluralIdsSuffix(name)) {
        reportNode(key, 'uuidArrayFieldMustEndWithIds', name);
      }
    }

    function getKeyName(
      key:
        | TSESTree.PropertyDefinition['key']
        | TSESTree.TSPropertySignature['key'],
      computed: boolean,
    ): { name: string; literalKey: boolean } | null {
      if (computed) return null;
      if (key.type === AST_NODE_TYPES.Identifier) {
        return { name: key.name, literalKey: false };
      }
      if (key.type === AST_NODE_TYPES.PrivateIdentifier) {
        return { name: key.name, literalKey: false };
      }
      if (
        key.type === AST_NODE_TYPES.Literal &&
        typeof key.value === 'string'
      ) {
        return { name: key.value, literalKey: true };
      }
      return null;
    }

    // --- collection -------------------------------------------------------
    // Every check is queued in traversal order and answered at Program:exit.

    const checks: Array<INameCheck | IObjectPropertyCheck> = [];

    function checkName(
      reportTarget: TSESTree.Node,
      name: string,
      typeNode: TSESTree.Node,
      literalKey = false,
    ): void {
      checks.push({ kind: 'name', reportTarget, name, typeNode, literalKey });
    }

    function checkBinding(id: TSESTree.Identifier): void {
      checkName(id, id.name, id);
    }

    function checkPropertyDefinition(node: TSESTree.PropertyDefinition): void {
      const keyInfo = getKeyName(node.key, node.computed);
      if (!keyInfo) return;
      checkName(node.key, keyInfo.name, node, keyInfo.literalKey);
    }

    function checkTSPropertySignature(
      node: TSESTree.TSPropertySignature,
    ): void {
      const keyInfo = getKeyName(node.key, node.computed);
      if (!keyInfo) return;
      if (!node.typeAnnotation) return;
      checkName(node.key, keyInfo.name, node, keyInfo.literalKey);
    }

    function checkParameter(param: TSESTree.Parameter): void {
      // Unwrap parameter-property modifiers (`private readonly userId: Uuid`).
      const unwrapped =
        param.type === AST_NODE_TYPES.TSParameterProperty
          ? param.parameter
          : param;
      // Unwrap default-value pattern.
      const inner =
        unwrapped.type === AST_NODE_TYPES.AssignmentPattern
          ? unwrapped.left
          : unwrapped;

      if (inner.type === AST_NODE_TYPES.Identifier) {
        checkBinding(inner);
        return;
      }
      if (inner.type === AST_NODE_TYPES.RestElement) {
        const arg = inner.argument;
        if (arg.type === AST_NODE_TYPES.Identifier) {
          checkBinding(arg);
        } else if (arg.type === AST_NODE_TYPES.ObjectPattern) {
          checkObjectPattern(arg);
        } else if (arg.type === AST_NODE_TYPES.ArrayPattern) {
          checkArrayPattern(arg);
        }
        return;
      }
      if (inner.type === AST_NODE_TYPES.ObjectPattern) {
        checkObjectPattern(inner);
        return;
      }
      if (inner.type === AST_NODE_TYPES.ArrayPattern) {
        checkArrayPattern(inner);
      }
    }

    function checkObjectPattern(pattern: TSESTree.ObjectPattern): void {
      for (const prop of pattern.properties) {
        if (prop.type !== AST_NODE_TYPES.Property) continue;
        const value =
          prop.value.type === AST_NODE_TYPES.AssignmentPattern
            ? prop.value.left
            : prop.value;
        if (value.type === AST_NODE_TYPES.Identifier) {
          checkBinding(value);
        } else if (value.type === AST_NODE_TYPES.ObjectPattern) {
          checkObjectPattern(value);
        } else if (value.type === AST_NODE_TYPES.ArrayPattern) {
          checkArrayPattern(value);
        }
      }
    }

    function checkArrayPattern(pattern: TSESTree.ArrayPattern): void {
      for (const element of pattern.elements) {
        if (!element) continue;
        const inner =
          element.type === AST_NODE_TYPES.AssignmentPattern
            ? element.left
            : element;
        if (inner.type === AST_NODE_TYPES.Identifier) {
          checkBinding(inner);
        } else if (inner.type === AST_NODE_TYPES.ObjectPattern) {
          checkObjectPattern(inner);
        } else if (inner.type === AST_NODE_TYPES.ArrayPattern) {
          checkArrayPattern(inner);
        } else if (inner.type === AST_NODE_TYPES.RestElement) {
          const arg = inner.argument;
          if (arg.type === AST_NODE_TYPES.Identifier) {
            checkBinding(arg);
          }
        }
      }
    }

    function checkVariableDeclarator(node: TSESTree.VariableDeclarator): void {
      const id = node.id;
      if (id.type === AST_NODE_TYPES.Identifier) {
        checkBinding(id);
      } else if (id.type === AST_NODE_TYPES.ObjectPattern) {
        checkObjectPattern(id);
      } else if (id.type === AST_NODE_TYPES.ArrayPattern) {
        checkArrayPattern(id);
      }
    }

    function checkObjectExpressionProperty(
      prop: TSESTree.Property,
      objectExpr: TSESTree.ObjectExpression,
    ): void {
      if (prop.computed) return;
      const keyInfo = getKeyName(
        prop.key as TSESTree.PropertyDefinition['key'],
        false,
      );
      if (!keyInfo) return;
      checks.push({
        kind: 'objectProperty',
        key: prop.key,
        name: keyInfo.name,
        objectExpr,
      });
    }

    // --- verification -----------------------------------------------------

    function verify(): void {
      const types = typesFor(context);
      if (types === undefined) return;
      checker = types.checker;

      const nameChecks = checks.filter(
        (check): check is INameCheck => check.kind === 'name',
      );
      const nameTypes = new Map<INameCheck, Type | undefined>();
      if (nameChecks.length > 0) {
        const answered = checker.getTypeAtLocation(
          nameChecks.map(({ typeNode }) => types.nodeFor(typeNode)),
        );
        nameChecks.forEach((check, index) =>
          nameTypes.set(check, answered[index]),
        );
      }

      // The property each literal property lands on, in its object's contextual type.
      const contextualTypes = new Map<
        TSESTree.ObjectExpression,
        Type | undefined
      >();
      const landingProperties = new Map<IObjectPropertyCheck, TsSymbol>();
      for (const check of checks) {
        if (check.kind !== 'objectProperty') continue;
        if (!contextualTypes.has(check.objectExpr)) {
          contextualTypes.set(
            check.objectExpr,
            checker.getContextualType(
              types.nodeFor(check.objectExpr) as Expression,
            ),
          );
        }
        const contextual = contextualTypes.get(check.objectExpr);
        const propSymbol = contextual?.getProperty(check.name);
        if (
          propSymbol &&
          (propSymbol.valueDeclaration ?? propSymbol.declarations[0])
        ) {
          landingProperties.set(check, propSymbol);
        }
      }
      // A property's type at its own declaration is its declared type: no flow
      // narrowing applies there, so its symbol's type is the same answer.
      const landing = [...landingProperties];
      const landingTypes =
        landing.length === 0
          ? []
          : checker.getTypeOfSymbol(landing.map(([, symbol]) => symbol));
      const propertyTypes = new Map(
        landing.map(([check], index) => [check, landingTypes[index]]),
      );

      for (const check of checks) {
        if (check.kind === 'name') {
          const type = nameTypes.get(check);
          if (type === undefined) continue;
          if (check.literalKey) {
            checkLiteralKeyForType(check.reportTarget, check.name, type);
          } else {
            checkNameForType(check.reportTarget, check.name, type);
          }
          continue;
        }
        const propType = propertyTypes.get(check);
        if (propType !== undefined) {
          checkObjectPropertyType(check, propType);
        }
      }
    }

    return {
      PropertyDefinition: checkPropertyDefinition,
      TSPropertySignature: checkTSPropertySignature,

      'FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSEmptyBodyFunctionExpression, TSDeclareFunction, TSFunctionType, TSMethodSignature'(
        node: TSESTree.FunctionLike | TSESTree.TSMethodSignature,
      ): void {
        for (const param of node.params) {
          checkParameter(param);
        }
      },

      VariableDeclarator: checkVariableDeclarator,

      CatchClause(node: TSESTree.CatchClause): void {
        if (!node.param) return;
        if (node.param.type === AST_NODE_TYPES.Identifier) {
          checkBinding(node.param);
        } else if (node.param.type === AST_NODE_TYPES.ObjectPattern) {
          checkObjectPattern(node.param);
        } else if (node.param.type === AST_NODE_TYPES.ArrayPattern) {
          checkArrayPattern(node.param);
        }
      },

      'ForOfStatement, ForInStatement'(
        node: TSESTree.ForOfStatement | TSESTree.ForInStatement,
      ): void {
        const left = node.left;
        if (left.type === AST_NODE_TYPES.VariableDeclaration) {
          for (const decl of left.declarations) {
            checkVariableDeclarator(decl);
          }
        }
      },

      ObjectExpression(node: TSESTree.ObjectExpression): void {
        for (const prop of node.properties) {
          if (prop.type !== AST_NODE_TYPES.Property) continue;
          checkObjectExpressionProperty(prop, node);
        }
      },

      // Types are asked for once per file, batched, when the file's declarations are all known.
      'Program:exit'(): void {
        if (checks.length > 0) verify();
      },
    };
  },
});
