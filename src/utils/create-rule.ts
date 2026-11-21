import type { TSESLint } from '@typescript-eslint/utils';

const DOCS_URL = 'https://github.com/m-one-dev/awesome-nest-oxlint/blob/main/docs/rules';

type Options = readonly unknown[];

interface IRuleSpec<TOptions extends Options, TMessageIds extends string> {
  name: string;
  meta: Omit<TSESLint.RuleMetaData<TMessageIds, unknown, TOptions>, 'docs'> & { docs: { description: string }; defaultOptions?: Readonly<TOptions> };
  create(context: Readonly<TSESLint.RuleContext<TMessageIds, TOptions>>, options: Readonly<TOptions>): TSESLint.RuleListener;
}

/**
 * A rule in the shape oxlint loads: `meta.docs.url` points at the rule's page, and `create` receives
 * the configured options, which oxlint has already laid over `meta.defaultOptions`.
 */
export const createRule = <TOptions extends Options, TMessageIds extends string>({ name, meta, create }: IRuleSpec<TOptions, TMessageIds>) => ({
  name,
  meta: { ...meta, docs: { ...meta.docs, url: `${DOCS_URL}/${name}.md` } },
  create: (context: Readonly<TSESLint.RuleContext<TMessageIds, TOptions>>): TSESLint.RuleListener => create(context, context.options),
});
