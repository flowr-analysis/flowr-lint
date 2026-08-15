# Linter rules for flowR

The eslint configuration for flowR and friends. For flowR's capability of linting R code see the
[linter wiki page](https://github.com/flowr-analysis/flowr/wiki/Linter), the main project lives at
<https://github.com/flowr-analysis/flowr>.

```shell
npm i -D @eagleoutice/eslint-config-flowr
```

That is the whole install: everything the configuration uses is a dependency of the package, only `eslint` stays a peer
dependency because it is the one instance that has to be shared. To register the tags below, extend the shipped TSDoc
configuration from your `tsdoc.json`:

```json
{ "extends": ["@eagleoutice/eslint-config-flowr/tsdoc.json"] }
```

## The `flowr` plugin

flowR groups its functions in helper objects (`DfEdge`, `Resolve`, `NodeId`, and friends) so that there is one obvious
entry point per topic. Two rules keep the code on those entry points, both on by default.

| rule | driven by | finds |
| :-- | :-- | :-- |
| `flowr/use-instead` | the `@useInstead` tag | a reference to what a helper object replaced |
| `flowr/replacement-pattern` | [`patterns.ts`](patterns.ts) | a shape of code with a helper equivalent |

Both fix in place when every name the replacement needs is already in scope, and offer an editor suggestion otherwise,
since a fixer cannot add the missing import. A type-only binding of the right name does not count.

### `flowr/use-instead`

A function that only exists to be wired into a helper object names its replacement:

```ts
/**
 * Every definition the identifier may refer to.
 * @useInstead {@link Resolve.byName}
 */
export function resolveByNameAnyType(/* ... */) { /* ... */ }
```

Every reference outside the declaring file is then reported. The tag works on a function, on a helper object, and on its
members. Never reported: the wiring inside an object literal (`byName: resolveByNameAnyType`), re-exports, and files
that declare the helper the tag points at.

Documentation is read once per TypeScript symbol, and member accesses are only inspected for PascalCase objects (the
`helperObjectPattern` option), so the rule stays cheap on large projects.

### `flowr/replacement-pattern`

Patterns are [esquery](https://github.com/estools/esquery) selectors, the language `no-restricted-syntax` uses.
To add one, append to [`patterns.ts`](patterns.ts):

```js
{
	id:         'edge-is-only-type',
	selector:   'BinaryExpression[operator="==="][left.property.name="types"]',
	capture:    { edge: 'left.object', type: 'right' },
	replace:    'DfEdge.isOnlyType({{edge}}, {{type}})',
	declaredIn: { 'left.property': 'dataflow/graph/edge' },
	message:    '`x.types === T` holds only if T is the *only* type.'
}
```

| field | |
| :-- | :-- |
| `selector` | what to match, required |
| `replace` | the replacement, required. `{{name}}` is a capture's source text, `{{name\|last}}` keeps the part behind its last dot, turning `VertexType.Use` into `Use` |
| `capture` | name to a path relative to the match |
| `declaredIn` | path to a file the node's symbol must come from, so an unrelated `types` or `tag` does not match. The declaring file itself is exempt |
| `sameText` | pairs of paths that must spell the same code, esquery has no back-references |
| `message` | what to tell the reader, filled from the captures like `replace` |
| `fix` | `true` always fixes, `false` always suggests, which is right when the replacement can change type narrowing. Omitted, it fixes when the replacement is in scope |
| `id` | names the pattern in `@lintIgnore` and in the message |

An own `patterns` array replaces the defaults rather than merging with them. To propose one, open an issue with the
[replacement pattern template](.github/ISSUE_TEMPLATE/replacement-pattern.yaml).

### Suppressing

| | silences |
| :-- | :-- |
| `// eslint-disable-next-line` | the next line, as usual |
| `@performanceCritical` | a hot path that has to keep the raw form |
| `@lintIgnore <ids>` | the named rules or pattern ids, all of them when given none |

A tag on a declaration covers everything below it, a header comment above the imports covers the file. The lookup is
guarded by a single string search, so files without either tag pay nothing.

## A part of unicorn

A hand-picked part of [unicorn](https://github.com/sindresorhus/eslint-plugin-unicorn) is enabled as well: the rules
naming a shape with a clearer equivalent (`prefer-includes`, `prefer-string-slice`, `no-useless-spread`, and friends),
not its opinions on naming or style. The list is in [`index.ts`](index.ts). Three are left out on purpose:

- `prefer-array-flat` rewrites `.flatMap(f => f)` on an iterator, which has no `.flat()`.
- `prefer-structured-clone` does not know that a `JSON` round-trip is sometimes the point.
- `prefer-node-protocol` is inverted: `no-restricted-imports` forbids the `node:` prefix instead, because flowR is
  bundled for the browser too, where the core modules are swapped for polyfills by their bare name (`path` to
  `path-browserify`, `fs` to `false`). A `node:` specifier matches none of those bundler keys.

## Working on it

The sources are TypeScript (`index.ts`, `patterns.ts`, `rules/*.ts`) and compile in place to the CommonJS files that
get published, so every import path a consumer uses stays what it was.

Node 24 or newer, the tests are TypeScript and run through Node's own type stripping.

```shell
npm run build      # tsc, what `prepublishOnly` runs
npm run typecheck  # sources and tests, no emit
npm test           # build, then `node --test` over the TypeScript tests
```
