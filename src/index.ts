import pkg from '../package.json' with { type: 'json' };
import { rules as ruleModules } from './rules/index.js';

/**
 * A rule as oxlint loads it. The rules are written against typescript-eslint's types, which are only
 * a build dependency, so the published declarations describe a rule by this shape alone.
 */
export interface IAwesomeNestRule {
  readonly meta: object;
  create(context: never): object;
}

/** The plugin as oxlint loads it. */
export interface IAwesomeNestPlugin {
  readonly meta: { readonly name: string; readonly version: string };
  readonly rules: Readonly<Record<string, IAwesomeNestRule>>;
}

/** Its rules, by name. */
export const rules: IAwesomeNestPlugin['rules'] = ruleModules;

/** The awesome-nest oxlint plugin (ADR 0105 in the HR Drone workspace): its rules, under the name `awesome-nest`. */
const plugin: IAwesomeNestPlugin = {
  meta: { name: 'awesome-nest', version: pkg.version },
  rules,
};

export default plugin;
