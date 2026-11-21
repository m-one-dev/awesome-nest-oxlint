import type { JSONSchema, TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/types';
import { type Checker, type Type, TypeFlags, type UnionOrIntersectionType } from 'tsrs/sync';

import { typesFor } from '../types/type-service.js';
import { createRule } from '../utils/create-rule.js';

// A port of @typescript-eslint/naming-convention (8.x) for the options this workspace uses, so it
// runs under oxlint (ADR 0105). Which names are checked, which option decides each one, and where
// and how a name is reported all follow typescript-eslint's rule and its naming-convention-utils.

type MessageIds = 'doesNotMatchFormat' | 'doesNotMatchFormatTrimmed' | 'missingAffix' | 'unexpectedUnderscore';

type Format = 'camelCase' | 'PascalCase' | 'snake_case' | 'UPPER_CASE';

type ConventionSelector = 'default' | 'variable' | 'interface' | 'typeLike' | 'memberLike';

/** One entry of the options array, in typescript-eslint's shape, limited to what this workspace uses. */
export interface INamingConventionOption {
  readonly selector: ConventionSelector;
  readonly format: readonly Format[];
  readonly filter?: { readonly regex: string; readonly match: boolean };
  readonly leadingUnderscore?: 'forbid';
  readonly prefix?: readonly string[];
  readonly modifiers?: readonly 'private'[];
  readonly types?: readonly 'boolean'[];
}

type Options = INamingConventionOption[];

/** The workspace's convention, used when the rule is given no options. */
const WORKSPACE_CONVENTION: Options = [
  {
    selector: 'default',
    format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'],
    filter: { regex: '^_.*$', match: false },
  },
  { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
  { selector: 'interface', format: ['PascalCase'] },
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'memberLike', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'forbid' },
  {
    selector: 'variable',
    types: ['boolean'],
    format: ['PascalCase'],
    prefix: ['is', 'should', 'has', 'can', 'show', 'hide', 'did', 'will', 'include', 'includes'],
  },
];

// ---------------------------------------------------------------------------
// selectors and modifiers, with typescript-eslint's values: precedence is decided by them
// ---------------------------------------------------------------------------

/** What kind of name each checked identifier is: typescript-eslint's individual selectors. */
const SELECTOR = {
  variable: 1,
  function: 2,
  parameter: 4,
  parameterProperty: 8,
  classicAccessor: 16,
  enumMember: 32,
  classMethod: 64,
  objectLiteralMethod: 128,
  typeMethod: 256,
  classProperty: 512,
  objectLiteralProperty: 1024,
  typeProperty: 2048,
  autoAccessor: 4096,
  class: 8192,
  interface: 16_384,
  typeAlias: 32_768,
  enum: 65_536,
  typeParameter: 131_072,
  import: 262_144,
} as const;

type SelectorName = keyof typeof SELECTOR;

/** The selectors that group individual ones: `default` covers them all. */
const META_SELECTOR: Readonly<Record<string, number>> = {
  default: -1,
  memberLike: 8184,
  typeLike: 253_952,
};

const PRIVATE = 32;
const REQUIRES_QUOTES = 4096;
const BOOLEAN_TYPE = 131_072;
/** typescript-eslint gives an option with a filter the highest weight among options of one selector. */
const FILTER_WEIGHT = 1 << 30;

/** The selectors a `types` option applies to; on any other it is ignored. */
const SELECTORS_WITH_TYPES =
  SELECTOR.variable |
  SELECTOR.parameter |
  SELECTOR.classProperty |
  SELECTOR.objectLiteralProperty |
  SELECTOR.typeProperty |
  SELECTOR.parameterProperty |
  SELECTOR.classicAccessor;

// ---------------------------------------------------------------------------
// formats
// ---------------------------------------------------------------------------

/** Leading, trailing and adjacent underscores. */
function hasValidUnderscores(name: string): boolean {
  if (name.startsWith('_')) {
    return false;
  }

  let wasUnderscore = false;

  for (let index = 1; index < name.length; index += 1) {
    if (name[index] === '_') {
      if (wasUnderscore) {
        return false;
      }
      wasUnderscore = true;
    } else {
      wasUnderscore = false;
    }
  }

  return !wasUnderscore;
}

const FORMAT_CHECKS: Readonly<Record<Format, (name: string) => boolean>> = {
  camelCase: (name) => name.length === 0 || (name[0] === name[0]?.toLowerCase() && !name.includes('_')),
  PascalCase: (name) => name.length === 0 || (name[0] === name[0]?.toUpperCase() && !name.includes('_')),
  snake_case: (name) => name.length === 0 || (name === name.toLowerCase() && hasValidUnderscores(name)),
  UPPER_CASE: (name) => name.length === 0 || (name === name.toUpperCase() && hasValidUnderscores(name)),
};

// TypeScript's isIdentifierStart/isIdentifierPart for ES2015 and later, tested one UTF-16 code unit
// at a time as typescript-eslint's requiresQuoting does.
const IDENTIFIER_START = /^[$_\p{ID_Start}]$/u;
const IDENTIFIER_PART = /^[$\u200C\u200D\p{ID_Continue}]$/u;

/** True when `name` can only be written as a quoted property name. */
function requiresQuoting(name: string): boolean {
  if (name.length === 0) {
    return true;
  }

  for (let index = 0; index < name.length; index += 1) {
    if (!(index === 0 ? IDENTIFIER_START : IDENTIFIER_PART).test(name.charAt(index))) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

interface IConvention {
  readonly selector: number;
  readonly isMeta: boolean;
  readonly weight: number;
  readonly formats: readonly Format[];
  readonly filter: { readonly regex: RegExp; readonly match: boolean } | undefined;
  readonly forbidLeadingUnderscore: boolean;
  readonly prefixes: readonly string[];
  readonly modifiers: number;
  readonly booleanOnly: boolean;
}

function normalize(option: INamingConventionOption): IConvention {
  const modifiers = option.modifiers === undefined ? 0 : PRIVATE;
  const booleanOnly = option.types !== undefined;
  const metaSelector = META_SELECTOR[option.selector];

  return {
    selector: metaSelector ?? SELECTOR[option.selector as SelectorName],
    isMeta: metaSelector !== undefined,
    weight: modifiers | (booleanOnly ? BOOLEAN_TYPE : 0) | (option.filter === undefined ? 0 : FILTER_WEIGHT),
    formats: option.format,
    filter: option.filter && { regex: new RegExp(option.filter.regex, 'u'), match: option.filter.match },
    forbidLeadingUnderscore: option.leadingUnderscore === 'forbid',
    prefixes: option.prefix ?? [],
    modifiers,
    booleanOnly,
  };
}

/**
 * The options that apply to a kind of name, most specific first, as typescript-eslint orders them:
 * an individual selector before a group, a narrower group before a wider one, and among options of
 * one selector the one with a filter, then types, then modifiers. The sort is stable, so options
 * that tie keep their configured order.
 */
function conventionsFor(conventions: readonly IConvention[], selector: number): IConvention[] {
  return conventions
    .filter((convention) => (convention.selector & selector) !== 0 || convention.selector === META_SELECTOR.default)
    .sort((a, b) => {
      if (a.selector === b.selector) {
        return b.weight - a.weight;
      }
      if (a.isMeta !== b.isMeta) {
        return a.isMeta ? 1 : -1;
      }

      return b.selector - a.selector;
    });
}

// ---------------------------------------------------------------------------
// judging a name
// ---------------------------------------------------------------------------

interface IVerdict {
  readonly messageId: MessageIds;
  readonly data: Readonly<Record<string, string>>;
}

/** A name a `types` option may decide, judged before its type is known. */
const NEEDS_TYPE = 'needsType';

/** "classProperty" → "Class Property", as typescript-eslint names a selector in its messages. */
const SELECTOR_LABEL = Object.fromEntries(
  Object.keys(SELECTOR).map((selector) => {
    const spaced = selector.replaceAll(/([A-Z])/g, ' $1');

    return [selector, spaced.charAt(0).toUpperCase() + spaced.slice(1)];
  }),
) as Readonly<Record<SelectorName, string>>;

/**
 * typescript-eslint's validator: the first option whose filter, modifiers and types the name meets
 * decides it, whether the name then passes or fails. Passing `isBoolean: undefined` stops at an
 * option that would need the name's type.
 */
function judge(
  conventions: readonly IConvention[],
  selector: SelectorName,
  name: string,
  modifiers: number,
  isBoolean: boolean | undefined,
): IVerdict | undefined | typeof NEEDS_TYPE {
  const type = SELECTOR_LABEL[selector];

  for (const convention of conventions) {
    if (convention.filter !== undefined && convention.filter.regex.test(name) !== convention.filter.match) {
      continue;
    }
    if ((modifiers & convention.modifiers) !== convention.modifiers) {
      continue;
    }
    if (convention.booleanOnly && (SELECTORS_WITH_TYPES & SELECTOR[selector]) !== 0) {
      if (isBoolean === undefined) {
        return NEEDS_TYPE;
      }
      if (!isBoolean) {
        continue;
      }
    }

    if (convention.forbidLeadingUnderscore && name.startsWith('_')) {
      return { messageId: 'unexpectedUnderscore', data: { count: 'one', name, position: 'leading', type } };
    }

    let processedName = name;

    if (convention.prefixes.length > 0) {
      const prefix = convention.prefixes.find((candidate) => name.startsWith(candidate));

      if (prefix === undefined) {
        return {
          messageId: 'missingAffix',
          data: { affixes: convention.prefixes.join(', '), name, position: 'prefix', type },
        };
      }
      processedName = name.slice(prefix.length);
    }

    // A name that requires quotes matches no format.
    if (
      (modifiers & REQUIRES_QUOTES) === 0 &&
      convention.formats.some((format) => FORMAT_CHECKS[format](processedName))
    ) {
      return undefined;
    }

    return {
      messageId: processedName === name ? 'doesNotMatchFormat' : 'doesNotMatchFormatTrimmed',
      data: { formats: convention.formats.join(', '), name, processedName, type },
    };
  }

  return undefined;
}

function sameVerdict(a: IVerdict | undefined, b: IVerdict | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// the names typescript-eslint checks
// ---------------------------------------------------------------------------

/** The name a checked node carries: an identifier's name, or a literal key's value as a string. */
function nameOf(node: TSESTree.Node): string {
  return node.type === AST_NODE_TYPES.Identifier || node.type === AST_NODE_TYPES.PrivateIdentifier
    ? node.name
    : String((node as { value?: unknown }).value);
}

/** The identifiers a binding pattern declares, as scope-manager's PatternVisitor finds them. */
function bindingIdentifiers(pattern: TSESTree.Node, found: TSESTree.Identifier[] = []): TSESTree.Identifier[] {
  switch (pattern.type) {
    case AST_NODE_TYPES.Identifier:
      found.push(pattern);
      break;
    case AST_NODE_TYPES.ObjectPattern:
      for (const property of pattern.properties) {
        bindingIdentifiers(property.type === AST_NODE_TYPES.Property ? property.value : property, found);
      }
      break;
    case AST_NODE_TYPES.ArrayPattern:
      for (const element of pattern.elements) {
        if (element !== null) {
          bindingIdentifiers(element, found);
        }
      }
      break;
    case AST_NODE_TYPES.AssignmentPattern:
      bindingIdentifiers(pattern.left, found);
      break;
    case AST_NODE_TYPES.RestElement:
      bindingIdentifiers(pattern.argument, found);
      break;
    default:
      break;
  }

  return found;
}

/** A class property whose value is a function is a method to typescript-eslint. */
const FUNCTION_VALUES: ReadonlySet<string> = new Set([
  AST_NODE_TYPES.ArrowFunctionExpression,
  AST_NODE_TYPES.FunctionExpression,
  AST_NODE_TYPES.TSEmptyBodyFunctionExpression,
]);

/** `private`, from a member's accessibility; a `#name` member is not private in this sense. */
function memberModifiers(node: {
  readonly key?: TSESTree.Node;
  readonly accessibility?: TSESTree.Accessibility | undefined;
}): number {
  return node.key?.type !== AST_NODE_TYPES.PrivateIdentifier && node.accessibility === 'private' ? PRIVATE : 0;
}

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/**
 * typescript-eslint's test for `types: ['boolean']`: the type without null and undefined, its
 * literals widened, prints as `boolean`. Asked once per distinct type. That can only hold for
 * `boolean` itself, a boolean literal, or a union holding a boolean literal, so only such a union
 * is put through typescript-eslint's chain of checker calls.
 */
function isBooleanType(checker: Checker, type: Type): boolean {
  if ((type.flags & (TypeFlags.Boolean | TypeFlags.BooleanLiteral)) !== 0) {
    return true;
  }
  if (
    (type.flags & TypeFlags.Union) === 0 ||
    !(type as UnionOrIntersectionType).getTypes().some((member) => (member.flags & TypeFlags.BooleanLiteral) !== 0)
  ) {
    return false;
  }

  const nonNullable = checker.getNonNullableType(type);

  return checker.typeToString(checker.getWidenedType(checker.getBaseTypeOfLiteralType(nonNullable))) === 'boolean';
}

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

function nonEmptyArrayOf(items: JSONSchema.JSONSchema4): JSONSchema.JSONSchema4 {
  return { type: 'array', minItems: 1, items };
}

const COMMON_PROPERTIES: Readonly<Record<string, JSONSchema.JSONSchema4>> = {
  format: nonEmptyArrayOf({ type: 'string', enum: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'] }),
  filter: {
    type: 'object',
    properties: { regex: { type: 'string' }, match: { type: 'boolean' } },
    required: ['regex', 'match'],
    additionalProperties: false,
  },
  leadingUnderscore: { type: 'string', enum: ['forbid'] },
  prefix: nonEmptyArrayOf({ type: 'string', minLength: 1 }),
};

const MODIFIERS_PROPERTY = nonEmptyArrayOf({ type: 'string', enum: ['private'] });

function selectorSchema(
  selector: ConventionSelector,
  extra: Readonly<Record<string, JSONSchema.JSONSchema4>> = {},
): JSONSchema.JSONSchema4 {
  return {
    type: 'object',
    description: `Selector '${selector}'`,
    properties: { selector: { type: 'string', enum: [selector] }, ...COMMON_PROPERTIES, ...extra },
    required: ['selector', 'format'],
    additionalProperties: false,
  };
}

// Inline, without $ref: oxlint validates with draft-04 Ajv and ignores references it cannot resolve.
const SCHEMA: JSONSchema.JSONSchema4 = {
  type: 'array',
  items: {
    oneOf: [
      selectorSchema('default', { modifiers: MODIFIERS_PROPERTY }),
      selectorSchema('variable', { types: nonEmptyArrayOf({ type: 'string', enum: ['boolean'] }) }),
      selectorSchema('interface'),
      selectorSchema('typeLike'),
      selectorSchema('memberLike', { modifiers: MODIFIERS_PROPERTY }),
    ],
  },
};

// ---------------------------------------------------------------------------
// rule
// ---------------------------------------------------------------------------

interface IReport {
  readonly node: TSESTree.Node;
  readonly verdict: IVerdict;
}

interface ITypeDependentName {
  readonly node: TSESTree.Node;
  readonly ifBoolean: IVerdict | undefined;
  readonly otherwise: IVerdict | undefined;
}

export const namingConvention = createRule<Options, MessageIds>({
  name: 'naming-convention',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        "Enforces this workspace's naming conventions: @typescript-eslint/naming-convention's behaviour for the selectors, modifiers, types and formats the workspace configures.",
    },
    messages: {
      doesNotMatchFormat: '{{type}} name `{{name}}` must match one of the following formats: {{formats}}',
      doesNotMatchFormatTrimmed:
        '{{type}} name `{{name}}` trimmed as `{{processedName}}` must match one of the following formats: {{formats}}',
      missingAffix: '{{type}} name `{{name}}` must have one of the following {{position}}es: {{affixes}}',
      unexpectedUnderscore: '{{type}} name `{{name}}` must not have a {{position}} underscore.',
    },
    schema: SCHEMA,
  },
  // No defaultOptions: oxlint would merge them into the configured options entry by entry. The
  // options are read from context.options, and the workspace's convention stands in when there are none.
  create(context): TSESLint.RuleListener {
    const conventions = (context.options.length > 0 ? context.options : WORKSPACE_CONVENTION).map(normalize);
    const conventionsBySelector = new Map<SelectorName, IConvention[]>();
    const reports: IReport[] = [];
    const typeDependent: ITypeDependentName[] = [];

    function check(node: TSESTree.Node, selector: SelectorName, modifiers = 0): void {
      let applicable = conventionsBySelector.get(selector);

      if (applicable === undefined) {
        applicable = conventionsFor(conventions, SELECTOR[selector]);
        conventionsBySelector.set(selector, applicable);
      }

      const name = nameOf(node);
      const verdict = judge(applicable, selector, name, modifiers, undefined);

      if (verdict !== NEEDS_TYPE) {
        if (verdict !== undefined) {
          reports.push({ node, verdict });
        }
        return;
      }

      // Only a name whose verdict changes with its type waits for the type.
      const ifBoolean = judge(applicable, selector, name, modifiers, true) as IVerdict | undefined;
      const otherwise = judge(applicable, selector, name, modifiers, false) as IVerdict | undefined;

      if (!sameVerdict(ifBoolean, otherwise)) {
        typeDependent.push({ node, ifBoolean, otherwise });
      } else if (ifBoolean !== undefined) {
        reports.push({ node, verdict: ifBoolean });
      }
    }

    function checkMember(key: TSESTree.Node, selector: SelectorName, modifiers: number): void {
      check(key, selector, requiresQuoting(nameOf(key)) ? modifiers | REQUIRES_QUOTES : modifiers);
    }

    function checkParameters(node: { readonly params: readonly TSESTree.Parameter[] }): void {
      for (const parameter of node.params) {
        if (parameter.type !== AST_NODE_TYPES.TSParameterProperty) {
          for (const identifier of bindingIdentifiers(parameter)) {
            check(identifier, 'parameter');
          }
        }
      }
    }

    function checkFunction(
      node: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.TSDeclareFunction,
    ): void {
      if (node.id) {
        check(node.id, 'function');
      }
      checkParameters(node);
    }

    function checkClass(node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void {
      if (node.id) {
        check(node.id, 'class');
      }
    }

    function checkPropertyDefinition(
      node: TSESTree.PropertyDefinition | TSESTree.TSAbstractPropertyDefinition,
    ): void {
      if (!node.computed) {
        const isMethod = node.value !== null && FUNCTION_VALUES.has(node.value.type);

        checkMember(node.key, isMethod ? 'classMethod' : 'classProperty', memberModifiers(node));
      }
    }

    function checkMethodDefinition(node: TSESTree.MethodDefinition | TSESTree.TSAbstractMethodDefinition): void {
      if (node.computed || node.kind === 'constructor') {
        return;
      }
      checkMember(node.key, node.kind === 'method' ? 'classMethod' : 'classicAccessor', memberModifiers(node));
    }

    function checkAccessorProperty(node: TSESTree.AccessorProperty | TSESTree.TSAbstractAccessorProperty): void {
      checkMember(node.key, 'autoAccessor', memberModifiers(node));
    }

    function checkImport(node: TSESTree.ImportDefaultSpecifier | TSESTree.ImportNamespaceSpecifier): void {
      check(node.local, 'import');
    }

    /** Whether each name's type is boolean, from tsrs; not boolean where the file is in no program. */
    function booleanTyped(nodes: readonly TSESTree.Node[]): boolean[] {
      const types = typesFor(context);

      if (types === undefined) {
        return nodes.map(() => false);
      }

      const { checker } = types;
      const nodeTypes = checker.getTypeAtLocation(nodes.map((node) => types.nodeFor(node)));
      const isBooleanById = new Map<number, boolean>();

      return nodeTypes.map((type) => {
        let isBoolean = isBooleanById.get(type.id);

        if (isBoolean === undefined) {
          isBoolean = isBooleanType(checker, type);
          isBooleanById.set(type.id, isBoolean);
        }

        return isBoolean;
      });
    }

    return {
      FunctionDeclaration: checkFunction,
      TSDeclareFunction: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      ImportDefaultSpecifier: checkImport,
      ImportNamespaceSpecifier: checkImport,
      ImportSpecifier(node): void {
        // Only `import { default as name }` is an import to typescript-eslint.
        if (node.imported.type !== AST_NODE_TYPES.Identifier || node.imported.name === 'default') {
          check(node.local, 'import');
        }
      },
      VariableDeclarator(node): void {
        for (const identifier of bindingIdentifiers(node.id)) {
          check(identifier, 'variable');
        }
      },
      PropertyDefinition: checkPropertyDefinition,
      TSAbstractPropertyDefinition: checkPropertyDefinition,
      MethodDefinition: checkMethodDefinition,
      TSAbstractMethodDefinition: checkMethodDefinition,
      AccessorProperty: checkAccessorProperty,
      TSAbstractAccessorProperty: checkAccessorProperty,
      Property(node): void {
        if (node.computed) {
          return;
        }
        if (node.kind !== 'init') {
          checkMember(node.key, 'classicAccessor', 0);
        } else if (FUNCTION_VALUES.has(node.value.type)) {
          checkMember(node.key, 'objectLiteralMethod', 0);
        } else if (node.parent.type !== AST_NODE_TYPES.ObjectPattern) {
          checkMember(node.key, 'objectLiteralProperty', 0);
        }
      },
      TSMethodSignature(node): void {
        if (!node.computed) {
          checkMember(node.key, 'typeMethod', 0);
        }
      },
      TSPropertySignature(node): void {
        if (!node.computed) {
          const isMethod = node.typeAnnotation?.typeAnnotation.type === AST_NODE_TYPES.TSFunctionType;

          checkMember(node.key, isMethod ? 'typeMethod' : 'typeProperty', 0);
        }
      },
      TSParameterProperty(node): void {
        for (const identifier of bindingIdentifiers(node.parameter)) {
          check(identifier, 'parameterProperty', memberModifiers(node));
        }
      },
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
      TSEnumDeclaration(node): void {
        check(node.id, 'enum');
      },
      TSEnumMember(node): void {
        checkMember(node.id, 'enumMember', 0);
      },
      TSInterfaceDeclaration(node): void {
        check(node.id, 'interface');
      },
      TSTypeAliasDeclaration(node): void {
        check(node.id, 'typeAlias');
      },
      TSTypeParameter(node): void {
        // Not an `infer` type or a mapped type's key.
        if (node.parent.type === AST_NODE_TYPES.TSTypeParameterDeclaration) {
          check(node.name, 'typeParameter');
        }
      },
      // Types are asked for once per file, in one request, when the file's names are all known.
      'Program:exit'(): void {
        if (typeDependent.length > 0) {
          const isBoolean = booleanTyped(typeDependent.map(({ node }) => node));

          typeDependent.forEach(({ node, ifBoolean, otherwise }, index) => {
            const verdict = isBoolean[index] === true ? ifBoolean : otherwise;

            if (verdict !== undefined) {
              reports.push({ node, verdict });
            }
          });
        }

        reports.sort((a, b) => a.node.range[0] - b.node.range[0]);

        for (const { node, verdict } of reports) {
          context.report({ node, messageId: verdict.messageId, data: verdict.data });
        }
      },
    };
  },
});
