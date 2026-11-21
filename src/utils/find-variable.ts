import type { TSESLint } from '@typescript-eslint/utils';

/** The variable `name` refers to from `scope`: the nearest enclosing scope that declares it. */
export const findVariable = (scope: TSESLint.Scope.Scope, name: string): TSESLint.Scope.Variable | undefined => {
  for (let current: TSESLint.Scope.Scope | null = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);

    if (variable !== undefined) {
      return variable;
    }
  }

  return undefined;
};
