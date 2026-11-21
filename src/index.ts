import pkg from '../package.json' with { type: 'json' };
import { rules } from './rules/index.js';

/** The awesome-nest oxlint plugin (ADR 0105 in the HR Drone workspace): its rules, under the name `awesome-nest`. */
const plugin = {
  meta: { name: 'awesome-nest', version: pkg.version },
  rules,
};

export default plugin;
export { rules };
