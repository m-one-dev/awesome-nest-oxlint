# awesome-nest/naming-convention

Enforces a naming convention for declarations. It accepts the subset of typescript-eslint's `@typescript-eslint/naming-convention` options that the m-one workspaces use, with the same meaning, and reports at the same places: selectors `default`, `variable`, `interface`, `typeLike` and `memberLike`; the modifier `private`; `types: ['boolean']` on `variable`; `format` (`camelCase`, `PascalCase`, `snake_case`, `UPPER_CASE`); `leadingUnderscore: 'forbid'`; `prefix`; and `filter`. Any other option is rejected.

The most specific matching selector wins, as in typescript-eslint. `types: ['boolean']` asks tsrs for the variable's type; everything else is syntactic.

## Example

```jsonc
"awesome-nest/naming-convention": [
  "error",
  { "selector": "default", "format": ["camelCase", "PascalCase", "snake_case", "UPPER_CASE"], "filter": { "regex": "^_.*$", "match": false } },
  { "selector": "variable", "format": ["camelCase", "UPPER_CASE"] },
  { "selector": "interface", "format": ["PascalCase"] },
  { "selector": "typeLike", "format": ["PascalCase"] },
  { "selector": "memberLike", "modifiers": ["private"], "format": ["camelCase"], "leadingUnderscore": "forbid" },
  { "selector": "variable", "types": ["boolean"], "format": ["PascalCase"], "prefix": ["is", "should", "has", "can", "show", "hide", "did", "will", "include", "includes"] }
]
```
