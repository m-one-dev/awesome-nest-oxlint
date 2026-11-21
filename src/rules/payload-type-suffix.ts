import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import type { Node } from 'tsrs/ast';
import { type Checker, type Symbol as TsSymbol, SymbolFlags, type Type, TypeFlags, type UnionOrIntersectionType } from 'tsrs/sync';

import { typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

type MessageIds =
  | 'payloadTypeSuffix'
  | 'sendArgTypeSuffix'
  | 'missingType'
  | 'paramNameMustBePayload';

export interface Options {
  allowedSuffixes?: string[];
  enforcePayloadParamName?: boolean;
}

type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression;

/**
 * What the rule found, in source order. A finding the syntax decides is ready to
 * report; the others wait for the type of their node, asked once per file.
 */
type Finding =
  | { kind: 'syntax'; descriptor: TSESLint.ReportDescriptor<MessageIds> }
  | { kind: 'payload'; typeNode: TSESTree.TypeNode }
  | { kind: 'send'; dataArg: TSESTree.Expression; method: string; classNode: ClassNode };

const DEFAULT_SUFFIXES: readonly string[] = [
  'PayloadDto',
  'PageOptionsDto',
  'CursorPageOptionsDto',
];

const UNWRAP_GENERICS = new Set([
  'Array',
  'ReadonlyArray',
  'Partial',
  'Required',
  'Readonly',
]);

const SKIPPED_TYPE_FLAGS =
  TypeFlags.Undefined |
  TypeFlags.Null |
  TypeFlags.Void |
  TypeFlags.Never |
  TypeFlags.Any |
  TypeFlags.Unknown;

export const payloadTypeSuffix = createRule<[Options], MessageIds>({
  name: 'payload-type-suffix',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Payload parameters on NATS controllers and AbstractClientService `send`/`emit` calls must use a type whose name ends with an allowed payload suffix.',
    },
    messages: {
      payloadTypeSuffix:
        "@Payload() parameter type '{{name}}' must end with one of: {{suffixes}}.",
      sendArgTypeSuffix:
        "Data argument of '{{method}}' has type '{{name}}' which must end with one of: {{suffixes}}.",
      missingType: '@Payload() parameter must have a type annotation.',
      paramNameMustBePayload:
        "@Payload() parameter must be named 'payload' (got '{{name}}').",
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowedSuffixes: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            minItems: 1,
          },
          enforcePayloadParamName: { type: 'boolean' },
        },
      },
    ],
    defaultOptions: [
      {
        allowedSuffixes: [...DEFAULT_SUFFIXES],
        enforcePayloadParamName: false,
      },
    ],
  },
  create(context, [rawOptions]) {
    const allowedSuffixes =
      rawOptions.allowedSuffixes && rawOptions.allowedSuffixes.length > 0
        ? rawOptions.allowedSuffixes
        : [...DEFAULT_SUFFIXES];
    const enforcePayloadParamName = rawOptions.enforcePayloadParamName ?? false;
    const suffixesText = allowedSuffixes.join(', ');
    const findings: Finding[] = [];

    /**
     * Whether a superclass symbol is AbstractClientService or descends from it,
     * following each class's declared base types.
     */
    function descendsFromAbstractClientService(
      checker: Checker,
      superSymbol: TsSymbol,
    ): boolean {
      const visited = new Set<number>();
      const stack: TsSymbol[] = [superSymbol];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || visited.has(current.id)) {
          continue;
        }
        visited.add(current.id);
        if (current.name === 'AbstractClientService') {
          return true;
        }
        if ((current.flags & SymbolFlags.Class) === 0) {
          continue;
        }
        for (const base of checker.getDeclaredTypeOfSymbol(current).getBaseTypes() ?? []) {
          const baseSymbol = base.getSymbol() ?? base.getAliasSymbol();
          if (baseSymbol) {
            stack.push(baseSymbol);
          }
        }
      }
      return false;
    }

    function findEnclosingClass(node: TSESTree.Node): ClassNode | null {
      let current: TSESTree.Node | undefined = node.parent;
      while (current) {
        if (
          current.type === AST_NODE_TYPES.ClassDeclaration ||
          current.type === AST_NODE_TYPES.ClassExpression
        ) {
          return current;
        }
        current = current.parent;
      }
      return null;
    }

    function matchesAllowedSuffix(name: string): boolean {
      return allowedSuffixes.some((suffix) => name.endsWith(suffix));
    }

    function extractNamesFromType(checker: Checker, type: Type, depth = 0): string[] {
      if (depth > 4) {
        return [];
      }
      if ((type.flags & SKIPPED_TYPE_FLAGS) !== 0) {
        return [];
      }
      if (type.isUnionType()) {
        const names: string[] = [];
        for (const member of (type as UnionOrIntersectionType).getTypes()) {
          names.push(...extractNamesFromType(checker, member, depth + 1));
        }
        return names;
      }
      const aliasSymbol = type.getAliasSymbol();
      const aliasName = aliasSymbol?.name;
      const aliasTypeArgument = aliasName && UNWRAP_GENERICS.has(aliasName) ? type.getAliasTypeArguments()[0] : undefined;
      if (aliasTypeArgument) {
        return extractNamesFromType(checker, aliasTypeArgument, depth + 1);
      }
      if (type.isTypeReference()) {
        const target = type.getTarget();
        const targetName = target.id === type.id ? undefined : target.getSymbol()?.name;
        const typeArgument = targetName && UNWRAP_GENERICS.has(targetName) ? checker.getTypeArguments(type)[0] : undefined;
        if (typeArgument) {
          return extractNamesFromType(checker, typeArgument, depth + 1);
        }
      }
      const symbol = aliasSymbol ?? type.getSymbol();
      const name = symbol?.name;
      if (!name || name === '__type' || name === '__object') {
        return [];
      }
      return [name];
    }

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

    function getParamIdentifierName(param: TSESTree.Parameter): string | null {
      if (param.type === AST_NODE_TYPES.Identifier) {
        return param.name;
      }
      if (
        param.type === AST_NODE_TYPES.AssignmentPattern &&
        param.left.type === AST_NODE_TYPES.Identifier
      ) {
        return param.left.name;
      }
      return null;
    }

    function getParamTypeAnnotation(
      param: TSESTree.Parameter,
    ): TSESTree.TSTypeAnnotation | undefined {
      if ('typeAnnotation' in param && param.typeAnnotation) {
        return param.typeAnnotation;
      }
      if (
        param.type === AST_NODE_TYPES.AssignmentPattern &&
        'typeAnnotation' in param.left &&
        param.left.typeAnnotation
      ) {
        return param.left.typeAnnotation;
      }
      return undefined;
    }

    function isFunctionLikeNode(type: AST_NODE_TYPES | undefined): boolean {
      return (
        type === AST_NODE_TYPES.FunctionDeclaration ||
        type === AST_NODE_TYPES.FunctionExpression ||
        type === AST_NODE_TYPES.ArrowFunctionExpression ||
        type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression ||
        type === AST_NODE_TYPES.TSFunctionType ||
        type === AST_NODE_TYPES.TSDeclareFunction
      );
    }

    /** The names in `type` that lack an allowed suffix, joined for the message; null when there are none. */
    function badNames(checker: Checker, type: Type): string | null {
      const bad = extractNamesFromType(checker, type).filter((n) => !matchesAllowedSuffix(n));
      return bad.length === 0 ? null : bad.join(' | ');
    }

    /**
     * Reports every finding in source order. The ones that wait for types are
     * resolved in one request, with the superclass of each class that calls
     * `send`/`emit`; outside any program only the syntactic ones report.
     */
    function reportFindings(): void {
      const typed = findings.filter((finding) => finding.kind !== 'syntax');
      const types = typed.length > 0 ? typesFor(context) : undefined;
      const typeOf = new Map<TSESTree.Node, Type>();
      const clientClasses = new Set<ClassNode>();

      if (types) {
        const { checker } = types;
        const classes = [
          ...new Set(typed.flatMap((finding) => (finding.kind === 'send' ? [finding.classNode] : []))),
        ];
        const queries: Array<{ node: TSESTree.Node; tsNode: Node }> = [
          ...classes.map((classNode) => ({ node: classNode.superClass!, tsNode: types.nodeFor(classNode.superClass!) })),
          ...typed.map((finding) =>
            finding.kind === 'payload'
              ? { node: finding.typeNode, tsNode: types.nodeFor(finding.typeNode) }
              : { node: finding.dataArg, tsNode: types.nodeFor(finding.dataArg) },
          ),
        ];
        const nodeTypes = checker.getTypeAtLocation(queries.map(({ tsNode }) => tsNode));

        queries.forEach(({ node }, index) => typeOf.set(node, nodeTypes[index]!));
        for (const classNode of classes) {
          const superType = typeOf.get(classNode.superClass!)!;
          const superSymbol = superType.getSymbol() ?? superType.getAliasSymbol();
          if (superSymbol && descendsFromAbstractClientService(checker, superSymbol)) {
            clientClasses.add(classNode);
          }
        }
      }

      for (const finding of findings) {
        if (finding.kind === 'syntax') {
          context.report(finding.descriptor);
          continue;
        }
        if (!types) {
          continue;
        }
        if (finding.kind === 'payload') {
          const name = badNames(types.checker, typeOf.get(finding.typeNode)!);
          if (name !== null) {
            context.report({
              node: finding.typeNode,
              messageId: 'payloadTypeSuffix',
              data: { name, suffixes: suffixesText },
            });
          }
          continue;
        }
        if (!clientClasses.has(finding.classNode)) {
          continue;
        }
        const name = badNames(types.checker, typeOf.get(finding.dataArg)!);
        if (name !== null) {
          context.report({
            node: finding.dataArg,
            messageId: 'sendArgTypeSuffix',
            data: { method: finding.method, name, suffixes: suffixesText },
          });
        }
      }
    }

    return {
      Decorator(node) {
        if (getDecoratorName(node) !== 'Payload') {
          return;
        }
        const param = node.parent;
        if (!param || !isFunctionLikeNode(param.parent?.type)) {
          return;
        }
        const typedParam = param as TSESTree.Parameter;

        if (enforcePayloadParamName) {
          const name = getParamIdentifierName(typedParam);
          if (name !== null && name !== 'payload') {
            findings.push({
              kind: 'syntax',
              descriptor: {
                node: typedParam,
                messageId: 'paramNameMustBePayload',
                data: { name },
              },
            });
          }
        }

        const typeAnnotation = getParamTypeAnnotation(typedParam);
        if (!typeAnnotation) {
          findings.push({
            kind: 'syntax',
            descriptor: {
              node: typedParam,
              messageId: 'missingType',
            },
          });

          return;
        }

        findings.push({ kind: 'payload', typeNode: typeAnnotation.typeAnnotation });
      },

      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.object.type !== AST_NODE_TYPES.ThisExpression ||
          callee.property.type !== AST_NODE_TYPES.Identifier
        ) {
          return;
        }
        const methodName = callee.property.name;
        if (methodName !== 'send' && methodName !== 'emit') {
          return;
        }
        const classNode = findEnclosingClass(node);
        if (!classNode?.superClass) {
          return;
        }
        const dataArg = node.arguments[1];
        if (
          !dataArg ||
          dataArg.type === AST_NODE_TYPES.ObjectExpression ||
          dataArg.type === AST_NODE_TYPES.ArrayExpression ||
          dataArg.type === AST_NODE_TYPES.SpreadElement
        ) {
          return;
        }
        findings.push({ kind: 'send', dataArg, method: methodName, classNode });
      },

      'Program:exit': reportFindings,
    };
  },
});
