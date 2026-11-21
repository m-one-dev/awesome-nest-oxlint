import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { getTouchingToken, type Node, type SourceFile, SyntaxKind } from 'tsrs/ast';
import { API, type Checker, type Snapshot } from 'tsrs/sync';

/** What a rule can ask TypeScript about the file it is linting. */
export interface IFileTypes {
  readonly checker: Checker;
  /** The TypeScript node for an oxlint node. */
  nodeFor(node: ILintedNode): Node;
  /** The program's own source files (no declaration files, nothing under node_modules), sorted by path. */
  programFiles(): readonly string[];
  /** The tree of one of `programFiles()`. */
  sourceFileOf(fileName: string): SourceFile;
  /** The text of one of `programFiles()`, without fetching its tree: the text this session gave tsrs, otherwise the file on disk. */
  textOf(fileName: string): string;
}

/** The parts of an oxlint node the type service reads. */
interface ILintedNode {
  readonly type: string;
  readonly range: readonly [number, number];
}

/** The parts of an oxlint rule context the type service reads. */
interface ILintedFile {
  readonly filename: string;
  readonly sourceCode: { readonly text: string };
}

// The programs a file can belong to, in the order they are tried: the ones pre-commit's tsc checks
// (a package's tsconfig.json, and api-gateway's e2e/tsconfig.typecheck.json for its e2e suites).
const PROGRAM_CONFIGS = ['tsconfig.json', 'tsconfig.typecheck.json'];

/**
 * One tsrs session for this oxlint process (ADR 0105). It opens a project the first time a file of
 * it is linted, and gives tsrs the text oxlint lints whenever that differs from what tsrs holds:
 * after a fix pass, or in a RuleTester case. Anything tsrs fails at is thrown, so the lint fails
 * loudly instead of a type-aware rule skipping a file.
 */
class TypeService {
  /** The texts this session has given tsrs, by file; any other file tsrs reads from disk. */
  readonly #given = new Map<string, string>();
  readonly #configOfFile = new Map<string, string | undefined>();
  readonly #opened = new Set<string>();
  #api: API | undefined;
  #snapshot: Snapshot | undefined;
  /** The last answer, so the type-aware rules linting one file share it; cleared when the snapshot it came from is replaced. */
  #last: { fileName: string; text: string; types: IFileTypes | undefined } | undefined;

  forFile(fileName: string, text: string): IFileTypes | undefined {
    if (this.#last?.fileName !== fileName || this.#last.text !== text) {
      this.#last = { fileName, text, types: this.#typesFor(fileName, text) };
    }

    return this.#last.types;
  }

  close(): void {
    this.#api?.close();
  }

  #typesFor(fileName: string, text: string): IFileTypes | undefined {
    this.#syncText(fileName, text);

    const config = this.#configFor(fileName);

    if (config === undefined) {
      return undefined;
    }

    const project = this.#current().getConfiguredProject(config);
    const sourceFile = project?.program.getSourceFile(fileName);

    if (project === undefined || sourceFile === undefined) {
      throw new Error(`awesome-nest: tsrs lost ${fileName} from ${config}`);
    }

    // Every position a rule sends assumes tsrs holds the text being linted.
    if (sourceFile.text !== text) {
      throw new Error(`awesome-nest: tsrs holds a different text of ${fileName} than the one being linted`);
    }

    return {
      checker: project.checker,
      nodeFor: (node) => nodeAt(sourceFile, fileName, ...spanOf(node), node.type),
      programFiles: () =>
        project.program
          .getSourceFileNames()
          .filter((name) => !name.endsWith('.d.ts') && !name.includes(`${path.sep}node_modules${path.sep}`))
          .toSorted((a, b) => a.localeCompare(b)),
      sourceFileOf: (name) => {
        const other = project.program.getSourceFile(name);

        if (other === undefined) {
          throw new Error(`awesome-nest: ${name} is not in ${config}`);
        }

        return other;
      },
      textOf: (name) => this.#given.get(name) ?? readFileSync(name, 'utf8'),
    };
  }

  #current(): Snapshot {
    if (this.#snapshot === undefined) {
      this.#api = new API({});
      this.#snapshot = this.#api.createSnapshot();
    }

    return this.#snapshot;
  }

  #update(changes: Parameters<Snapshot['update']>[0]): void {
    const previous = this.#current();

    this.#snapshot = previous.update(changes);
    this.#last = undefined;
    previous.dispose();
  }

  /** Gives tsrs the text oxlint lints, as a filesystem layer over the disk, when tsrs holds another. */
  #syncText(fileName: string, text: string): void {
    const held = this.#given.get(fileName) ?? (existsSync(fileName) ? readFileSync(fileName, 'utf8') : undefined);

    if (held === text) {
      return;
    }

    this.#given.set(fileName, text);
    this.#update({
      fileSystem: { kind: 'layer', files: { [fileName]: text } },
      fileNotifications: held === undefined ? { created: [fileName] } : { changed: [fileName] },
      // A notification only marks a program dirty; tsrs rebuilds it when asked to.
      ensurePrograms: true,
    });
  }

  /** The first program, walking up to the package root, that contains `fileName`. */
  #configFor(fileName: string): string | undefined {
    if (!this.#configOfFile.has(fileName)) {
      this.#configOfFile.set(fileName, this.#findConfig(fileName));
    }

    return this.#configOfFile.get(fileName);
  }

  #findConfig(fileName: string): string | undefined {
    for (let dir = path.dirname(fileName); ; dir = path.dirname(dir)) {
      const found = PROGRAM_CONFIGS.map((name) => path.join(dir, name)).find((config) => existsSync(config) && this.#contains(config, fileName));

      if (found !== undefined || existsSync(path.join(dir, 'package.json')) || path.dirname(dir) === dir) {
        return found;
      }
    }
  }

  #contains(config: string, fileName: string): boolean {
    if (!this.#opened.has(config)) {
      this.#update({ openProjects: [config] });
      this.#opened.add(config);
    }

    return this.#current().getConfiguredProject(config)?.program.getSourceFile(fileName) !== undefined;
  }
}

/**
 * The span TypeScript gives the node. ESTree stretches an Identifier over its type annotation and
 * `?` (`adminId?: Uuid` in a parameter or declaration); TypeScript's Identifier is the name alone.
 */
function spanOf(node: ILintedNode): [number, number] {
  const [start, end] = node.range;

  return node.type === 'Identifier' ? [start, start + (node as unknown as { name: string }).name.length] : [start, end];
}

/**
 * The TypeScript node kind an oxlint node of each ESTree type stands for, where TypeScript nests
 * several nodes over one span: a type annotation `Foo` is a TypeReference around an Identifier
 * with the same span, and asking for the Identifier's type in that position answers `any`.
 */
const KIND_FOR: Readonly<Record<string, SyntaxKind>> = {
  TSTypeReference: SyntaxKind.TypeReference,
  TSQualifiedName: SyntaxKind.QualifiedName,
  TSTypeQuery: SyntaxKind.TypeQuery,
  TSClassImplements: SyntaxKind.ExpressionWithTypeArguments,
  TSInterfaceHeritage: SyntaxKind.ExpressionWithTypeArguments,
  TSArrayType: SyntaxKind.ArrayType,
  TSUnionType: SyntaxKind.UnionType,
  TSIntersectionType: SyntaxKind.IntersectionType,
  TSTypeLiteral: SyntaxKind.TypeLiteral,
};

/**
 * The TypeScript node for an oxlint node: of the nodes spanning exactly `[start, end)`, the one of
 * the kind the oxlint node stands for (KIND_FOR), otherwise the innermost.
 */
function nodeAt(sourceFile: SourceFile, fileName: string, start: number, end: number, esType: string): Node {
  const exact: Node[] = [];

  for (let node: Node | undefined = getTouchingToken(sourceFile, start); node !== undefined && node.kind !== SyntaxKind.SourceFile; node = node.parent) {
    const nodeStart = node.getStart(sourceFile);

    if (nodeStart === start && node.end === end) {
      exact.push(node);
    } else if (nodeStart < start || node.end > end) {
      break;
    }
  }

  const wanted = KIND_FOR[esType];
  const found = (wanted === undefined ? undefined : exact.find((node) => node.kind === wanted)) ?? exact[0];

  if (found === undefined) {
    throw new Error(`awesome-nest: no TypeScript node spans ${start}-${end} in ${fileName}`);
  }

  return found;
}

let service: TypeService | undefined;

/**
 * TypeScript's view of the file a rule is linting, from tsrs: undefined when no program the file
 * belongs to exists (ADR 0105), so a type-aware rule has nothing to check there.
 */
export function typesFor(context: ILintedFile): IFileTypes | undefined {
  if (service === undefined) {
    service = new TypeService();
    process.once('exit', () => service?.close());
  }

  return service.forFile(context.filename, context.sourceCode.text);
}
