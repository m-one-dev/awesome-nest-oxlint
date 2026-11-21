import type { TSESTree } from '@typescript-eslint/types';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import {
  type ClassDeclaration,
  type ClassElement,
  type ClassExpression,
  type Decorator,
  type GetAccessorDeclaration,
  isArrayLiteralExpression,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isComputedPropertyName,
  isDecorator,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isSetAccessorDeclaration,
  isShorthandPropertyAssignment,
  isStringLiteral,
  type MethodDeclaration,
  type Node,
  type SetAccessorDeclaration,
  type SourceFile,
  SyntaxKind,
} from 'tsrs/ast';
import {
  type Checker,
  type Symbol as TsSymbol,
  SymbolFlags,
  type Type,
  TypeFlags,
  type UnionOrIntersectionType,
} from 'tsrs/sync';

import { type IFileTypes, typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

type MessageIds = 'duplicateDto';

type Position = 'body' | 'query' | 'response';

export interface Options {
  suffixes?: string[];
  responseWrappers?: string[];
  swaggerResponseDecorators?: string[];
}

const DEFAULT_SUFFIXES: readonly string[] = ['Dto'];

const DEFAULT_RESPONSE_WRAPPERS: readonly string[] = [
  'Promise',
  'Observable',
  'Array',
  'ReadonlyArray',
  'PageDto',
  'PageOptionsDto',
];

const DEFAULT_SWAGGER_DECORATORS: readonly string[] = [
  'ApiResponse',
  'ApiOkResponse',
  'ApiCreatedResponse',
  'ApiAcceptedResponse',
  'ApiDefaultResponse',
  'ApiNoContentResponse',
  'ApiPageResponse',
];

const HTTP_METHOD_DECORATORS: ReadonlySet<string> = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Options',
  'Head',
  'All',
]);

const SKIPPED_TYPE_FLAGS =
  TypeFlags.Undefined |
  TypeFlags.Null |
  TypeFlags.Void |
  TypeFlags.Never |
  TypeFlags.Any |
  TypeFlags.Unknown |
  TypeFlags.String |
  TypeFlags.Number |
  TypeFlags.Boolean |
  TypeFlags.BigInt |
  TypeFlags.ESSymbol |
  TypeFlags.StringLiteral |
  TypeFlags.NumberLiteral |
  TypeFlags.BooleanLiteral;

interface IResolvedOptions {
  readonly suffixes: readonly string[];
  readonly responseWrappers: ReadonlySet<string>;
  readonly swaggerResponseDecorators: ReadonlySet<string>;
  /** Tells one set of options from another in the per-program cache. */
  readonly key: string;
}

interface IResolvedDto {
  readonly name: string;
  readonly key: string;
}

interface ILocation {
  readonly line: number;
  readonly column: number;
}

/** A DTO in one endpoint slot, in whichever file of the program it is. */
interface IUsage {
  readonly fileName: string;
  /** Where the slot's type or class reference is, as ESLint counts lines (1-based) and columns (0-based). */
  readonly start: ILocation;
  readonly end: ILocation;
  readonly controller: string;
  readonly method: string;
  readonly position: Position;
}

/** A usage its file reports, and the usage that owns its DTO. */
interface IDuplicate {
  readonly usage: IUsage;
  readonly name: string;
  readonly owner: IUsage;
}

/** One endpoint slot the program scan finds, before tsrs resolves its DTOs. */
interface ISlot {
  readonly kind: 'type' | 'class';
  /** A type annotation for `type` slots, a class reference in a Swagger decorator for `class` slots. */
  readonly node: Node;
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly controller: string;
  readonly method: string;
  readonly position: Position;
}

/** What one program's scan found, for one set of options. */
interface IProgramDuplicates {
  readonly fileNames: ReadonlySet<string>;
  readonly duplicatesByFile: ReadonlyMap<string, readonly IDuplicate[]>;
}

/**
 * Each program is scanned once per set of options, the first time a file of it with a controller
 * is linted. A tsrs snapshot change (a fix pass, a RuleTester case) gives the program a new
 * checker, so a changed program is scanned again.
 */
const scans = new WeakMap<Checker, Map<string, IProgramDuplicates>>();

function resolveOptions(rawOptions: Options): IResolvedOptions {
  const suffixes =
    rawOptions.suffixes && rawOptions.suffixes.length > 0
      ? rawOptions.suffixes
      : [...DEFAULT_SUFFIXES];
  const responseWrappers =
    rawOptions.responseWrappers && rawOptions.responseWrappers.length > 0
      ? rawOptions.responseWrappers
      : [...DEFAULT_RESPONSE_WRAPPERS];
  const swaggerResponseDecorators =
    rawOptions.swaggerResponseDecorators &&
    rawOptions.swaggerResponseDecorators.length > 0
      ? rawOptions.swaggerResponseDecorators
      : [...DEFAULT_SWAGGER_DECORATORS];

  return {
    suffixes,
    responseWrappers: new Set(responseWrappers),
    swaggerResponseDecorators: new Set(swaggerResponseDecorators),
    key: JSON.stringify([suffixes, responseWrappers, swaggerResponseDecorators]),
  };
}

// ---------------------------------------------------------------------------
// The linted file's own AST: only whether it declares a controller
// ---------------------------------------------------------------------------

function getEsDecoratorName(decorator: TSESTree.Decorator): string | null {
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

function isEsControllerClass(
  classNode: TSESTree.ClassDeclaration | TSESTree.ClassExpression,
): boolean {
  return (classNode.decorators ?? []).some(
    (d) => getEsDecoratorName(d) === 'Controller',
  );
}

// ---------------------------------------------------------------------------
// The program scan, over tsrs's trees of every file in the program
// ---------------------------------------------------------------------------

/** ESTree drops parentheses; TypeScript keeps them as nodes. */
function skipParentheses(node: Node): Node {
  let current = node;
  while (isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function decoratorsOf(modifiers: readonly Node[] | undefined): Decorator[] {
  const decorators: Decorator[] = [];
  for (const modifier of modifiers ?? []) {
    if (isDecorator(modifier)) {
      decorators.push(modifier);
    }
  }
  return decorators;
}

function getDecoratorName(decorator: Decorator): string | null {
  const expr = skipParentheses(decorator.expression);
  if (isIdentifier(expr)) {
    return expr.text;
  }
  if (isCallExpression(expr)) {
    const callee = skipParentheses(expr.expression);
    if (isIdentifier(callee)) {
      return callee.text;
    }
  }
  return null;
}

function isCallWithStringArg(decorator: Decorator): boolean {
  const expr = skipParentheses(decorator.expression);
  if (!isCallExpression(expr)) {
    return false;
  }
  const arg = expr.arguments[0];
  return arg !== undefined && isStringLiteral(skipParentheses(arg));
}

/** The name ESTree's `MethodDefinition.key` gives a method. */
function getMethodName(name: Node): string {
  const key = isComputedPropertyName(name) ? skipParentheses(name.expression) : name;
  if (isIdentifier(key) || isStringLiteral(key)) {
    return key.text;
  }
  if (isNumericLiteral(key)) {
    return String(Number(key.text));
  }
  return '<computed>';
}

/** The members ESTree calls a `MethodDefinition`: methods and accessors that are not abstract. */
function isMethodDefinition(
  member: ClassElement,
): member is MethodDeclaration | GetAccessorDeclaration | SetAccessorDeclaration {
  if (!isMethodDeclaration(member) && !isGetAccessorDeclaration(member) && !isSetAccessorDeclaration(member)) {
    return false;
  }
  return !(member.modifiers ?? []).some((modifier) => modifier.kind === SyntaxKind.AbstractKeyword);
}

/**
 * The endpoint slots of one file, in the order the rule records them: per controller (outer
 * before nested), per endpoint, its `@Body()`/`@Query()` parameters, then its return type,
 * then the `type:` of each Swagger response decorator.
 */
function collectSlots(
  sourceFile: SourceFile,
  fileName: string,
  options: IResolvedOptions,
  out: ISlot[],
): void {
  function push(
    kind: ISlot['kind'],
    node: Node,
    controller: string,
    method: string,
    position: Position,
  ): void {
    out.push({ kind, node, sourceFile, fileName, controller, method, position });
  }

  function collectClassReferences(
    expr: Node,
    controller: string,
    method: string,
  ): void {
    if (isIdentifier(expr)) {
      push('class', expr, controller, method, 'response');
      return;
    }
    if (!isArrayLiteralExpression(expr)) {
      return;
    }
    for (const element of expr.elements) {
      const inner = skipParentheses(element);
      if (isIdentifier(inner) || isArrayLiteralExpression(inner)) {
        collectClassReferences(inner, controller, method);
      }
    }
  }

  function collectSwaggerResponses(
    decorators: readonly Decorator[],
    controller: string,
    method: string,
  ): void {
    for (const decorator of decorators) {
      const name = getDecoratorName(decorator);
      const expr = skipParentheses(decorator.expression);
      if (!name || !options.swaggerResponseDecorators.has(name) || !isCallExpression(expr)) {
        continue;
      }
      const arg = expr.arguments[0];
      const options_ = arg === undefined ? undefined : skipParentheses(arg);
      if (options_ === undefined || !isObjectLiteralExpression(options_)) {
        continue;
      }
      for (const prop of options_.properties) {
        if (
          isShorthandPropertyAssignment(prop) &&
          isIdentifier(prop.name) &&
          prop.name.text === 'type'
        ) {
          collectClassReferences(prop.name, controller, method);
        } else if (
          isPropertyAssignment(prop) &&
          isIdentifier(prop.name) &&
          prop.name.text === 'type'
        ) {
          collectClassReferences(skipParentheses(prop.initializer), controller, method);
        }
      }
    }
  }

  function visitController(classNode: ClassDeclaration | ClassExpression): void {
    const controller = classNode.name?.text ?? '<anonymous>';
    for (const member of classNode.members) {
      if (!isMethodDefinition(member)) {
        continue;
      }
      const decorators = decoratorsOf(member.modifiers);
      if (!decorators.some((d) => HTTP_METHOD_DECORATORS.has(getDecoratorName(d) ?? ''))) {
        continue;
      }
      const method = getMethodName(member.name);
      for (const param of member.parameters) {
        const paramDecorators = decoratorsOf(param.modifiers);
        const body = paramDecorators.find((d) => getDecoratorName(d) === 'Body');
        if (body && !isCallWithStringArg(body)) {
          if (param.type) {
            push('type', param.type, controller, method, 'body');
          }
          continue;
        }
        const query = paramDecorators.find((d) => getDecoratorName(d) === 'Query');
        if (query && !isCallWithStringArg(query) && param.type) {
          push('type', param.type, controller, method, 'query');
        }
      }
      if (member.type) {
        push('type', member.type, controller, method, 'response');
      }
      collectSwaggerResponses(decorators, controller, method);
    }
  }

  function visit(node: Node): undefined {
    if (
      (isClassDeclaration(node) || isClassExpression(node)) &&
      decoratorsOf(node.modifiers).some((d) => getDecoratorName(d) === 'Controller')
    ) {
      visitController(node);
    }
    node.forEachChild(visit);
    return undefined;
  }

  sourceFile.forEachChild(visit);
}

/**
 * Every DTO usage in the program's endpoint slots, and the usages each file reports: the first
 * usage of a DTO, by file path and then by the order the rule records a file's slots, owns it, and
 * every later usage in another slot is a duplicate. Lint order plays no part.
 */
function scanProgram(types: IFileTypes, options: IResolvedOptions): IProgramDuplicates {
  const { checker } = types;
  const fileNames = types.programFiles();
  const slots: ISlot[] = [];

  for (const fileName of fileNames) {
    // A controller is a class decorated `@Controller`, so a file without the word has none, and its tree is not fetched.
    if (types.textOf(fileName).includes('Controller')) {
      collectSlots(types.sourceFileOf(fileName), fileName, options, slots);
    }
  }

  function matchesSuffix(name: string): boolean {
    return options.suffixes.some((suffix) => name.endsWith(suffix));
  }

  function symbolToKey(symbol: TsSymbol, name: string): string {
    const declFile = symbol.declarations[0]?.path ?? '<unknown>';
    return `${declFile}::${name}`;
  }

  function resolveSymbol(symbol: TsSymbol): TsSymbol {
    if ((symbol.flags & SymbolFlags.Alias) !== 0) {
      return checker.getAliasedSymbol(symbol);
    }
    return symbol;
  }

  function collectDtosFromTsType(
    type: Type,
    out: IResolvedDto[],
    seen: Set<number>,
    depth = 0,
  ): void {
    if (depth > 6 || seen.has(type.id)) {
      return;
    }
    seen.add(type.id);
    if ((type.flags & SKIPPED_TYPE_FLAGS) !== 0) {
      return;
    }
    if (type.isUnionType() || type.isIntersectionType()) {
      for (const member of (type as UnionOrIntersectionType).getTypes()) {
        collectDtosFromTsType(member, out, seen, depth + 1);
      }
      return;
    }

    const aliasSymbol = type.getAliasSymbol();
    const aliasName = aliasSymbol?.name;
    if (aliasName && options.responseWrappers.has(aliasName)) {
      const aliasArgument = type.getAliasTypeArguments()[0];
      if (aliasArgument) {
        collectDtosFromTsType(aliasArgument, out, seen, depth + 1);
        return;
      }
    }

    if (type.isTypeReference()) {
      const target = type.getTarget();
      if (target.id !== type.id) {
        const targetName = target.getSymbol()?.name;
        if (targetName && options.responseWrappers.has(targetName)) {
          for (const arg of checker.getTypeArguments(type)) {
            collectDtosFromTsType(arg, out, seen, depth + 1);
          }
          return;
        }
      }
    }

    const rawSymbol = aliasSymbol ?? type.getSymbol();
    if (!rawSymbol) {
      return;
    }
    const symbol = resolveSymbol(rawSymbol);
    const name = symbol.name;
    if (!name || name === '__type' || name === '__object') {
      return;
    }
    if (options.responseWrappers.has(name)) {
      return;
    }
    if (!matchesSuffix(name)) {
      return;
    }
    out.push({ name, key: symbolToKey(symbol, name) });
  }

  /** The DTO class a decorator's `type:` reference names, if any. */
  function dtoOfClassReference(symbolAtLocation: TsSymbol | undefined): IResolvedDto | null {
    if (!symbolAtLocation) {
      return null;
    }
    const symbol = resolveSymbol(symbolAtLocation);
    const name = symbol.name;
    if (!name || !matchesSuffix(name)) {
      return null;
    }
    return { name, key: symbolToKey(symbol, name) };
  }

  function locationOf(sourceFile: SourceFile, position: number): ILocation {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
    return { line: line + 1, column: character };
  }

  // Types and symbols are asked for once per program, in one request per kind.
  const typeSlots = slots.filter((slot) => slot.kind === 'type');
  const classSlots = slots.filter((slot) => slot.kind === 'class');
  const slotTypes = new Map<ISlot, Type>();
  const slotSymbols = new Map<ISlot, TsSymbol | undefined>();

  if (typeSlots.length > 0) {
    const found = checker.getTypeAtLocation(typeSlots.map((slot) => slot.node));
    typeSlots.forEach((slot, index) => slotTypes.set(slot, found[index]!));
  }
  if (classSlots.length > 0) {
    const found = checker.getSymbolAtLocation(classSlots.map((slot) => slot.node));
    classSlots.forEach((slot, index) => slotSymbols.set(slot, found[index]));
  }

  const usagesByDto = new Map<string, IUsage[]>();
  const duplicatesByFile = new Map<string, IDuplicate[]>();

  for (const slot of slots) {
    const dtos: IResolvedDto[] = [];

    if (slot.kind === 'type') {
      collectDtosFromTsType(slotTypes.get(slot)!, dtos, new Set());
    } else {
      const dto = dtoOfClassReference(slotSymbols.get(slot));
      if (dto) {
        dtos.push(dto);
      }
    }

    if (dtos.length === 0) {
      continue;
    }

    const usage: IUsage = {
      fileName: slot.fileName,
      start: locationOf(slot.sourceFile, slot.node.getStart(slot.sourceFile)),
      end: locationOf(slot.sourceFile, slot.node.end),
      controller: slot.controller,
      method: slot.method,
      position: slot.position,
    };

    for (const dto of dtos) {
      const existing = usagesByDto.get(dto.key);
      if (!existing) {
        usagesByDto.set(dto.key, [usage]);
        continue;
      }
      const sameSlot = existing.some(
        (u) =>
          u.fileName === usage.fileName &&
          u.controller === usage.controller &&
          u.method === usage.method &&
          u.position === usage.position,
      );
      if (sameSlot) {
        continue;
      }
      existing.push(usage);
      const duplicates = duplicatesByFile.get(usage.fileName) ?? [];
      duplicates.push({ usage, name: dto.name, owner: existing[0]! });
      duplicatesByFile.set(usage.fileName, duplicates);
    }
  }

  return { fileNames: new Set(fileNames), duplicatesByFile };
}

/** The duplicates `fileName` reports, from its program's scan. */
function duplicatesIn(types: IFileTypes, options: IResolvedOptions, fileName: string): readonly IDuplicate[] {
  let byOptions = scans.get(types.checker);
  if (byOptions === undefined) {
    byOptions = new Map();
    scans.set(types.checker, byOptions);
  }

  let scan = byOptions.get(options.key);
  if (scan === undefined) {
    scan = scanProgram(types, options);
    byOptions.set(options.key, scan);
  }

  if (!scan.fileNames.has(fileName)) {
    throw new Error(`awesome-nest: ${fileName} is not among the files of its program`);
  }

  return scan.duplicatesByFile.get(fileName) ?? [];
}

export const uniqueEndpointDtos = createRule<[Options], MessageIds>({
  name: 'unique-endpoint-dtos',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Each DTO class may appear in at most one NestJS endpoint slot (request body, query, or response) across the project.',
    },
    messages: {
      duplicateDto:
        "DTO '{{name}}' is already used as the {{prevPosition}} of {{prevController}}.{{prevMethod}} ({{prevLocation}}). Each endpoint slot must use its own DTO.",
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          suffixes: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            minItems: 1,
          },
          responseWrappers: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          swaggerResponseDecorators: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    ],
    defaultOptions: [
      {
        suffixes: [...DEFAULT_SUFFIXES],
        responseWrappers: [...DEFAULT_RESPONSE_WRAPPERS],
        swaggerResponseDecorators: [...DEFAULT_SWAGGER_DECORATORS],
      },
    ],
  },
  create(context, [rawOptions]) {
    // Only a file that declares a controller can hold a duplicate, so only such a file asks tsrs.
    let hasController = false;

    function noteController(node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void {
      if (isEsControllerClass(node)) {
        hasController = true;
      }
    }

    return {
      [AST_NODE_TYPES.ClassDeclaration]: noteController,
      [AST_NODE_TYPES.ClassExpression]: noteController,
      'Program:exit'(): void {
        if (!hasController) {
          return;
        }

        const types = typesFor(context);

        if (types === undefined) {
          return;
        }

        for (const { usage, name, owner } of duplicatesIn(types, resolveOptions(rawOptions), context.filename)) {
          context.report({
            loc: { start: usage.start, end: usage.end },
            messageId: 'duplicateDto',
            data: {
              name,
              prevController: owner.controller,
              prevMethod: owner.method,
              prevPosition: owner.position,
              prevLocation: `${owner.fileName}:${owner.start.line}:${owner.start.column}`,
            },
          });
        }
      },
    };
  },
});
