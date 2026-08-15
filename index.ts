import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import stylistic from '@stylistic/eslint-plugin';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import importX from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import flowr from './plugin';
import flowrPatterns from './patterns';

const config = [
	js.configs.recommended,
	...tseslint.configs['flat/recommended-type-checked'],
	...tseslint.configs['flat/strict'],
	...tseslint.configs['flat/recommended'],
	jsdoc.configs['flat/recommended-typescript'],
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType:  'module',
			globals:     { ...globals.node },
			parser:      tsParser,
			parserOptions: {
				projectService: true
			}
		},
		settings: {
			'import-x/resolver-next': [
				importX.createNodeResolver({ extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] })
			]
		},
		plugins: {
			'@typescript-eslint': tseslint,
			'@stylistic':         stylistic,
			'import-x':           importX,
			'unused-imports':     unusedImports,
			'check-file':         checkFile,
			tsdoc,
			jsdoc,
			flowr,
			unicorn
		},
		rules: {
			/* point at the helper object named by the `@useInstead` tag of a declaration */
			'flowr/use-instead': 'error',
			/* the hand-written forms of the helper calls, see `patterns.js` */
			'flowr/replacement-pattern': ['error', { patterns: flowrPatterns }],

			/* flowR is bundled for the browser as well, where the core modules are swapped for polyfills by their bare
			 * name (`path` to `path-browserify`, `fs` to `false`, ...). A `node:` prefix does not match those keys,
			 * so it would force every consumer to strip it again before bundling. */
			'no-restricted-imports': ['error', {
				patterns: [{
					group:   ['node:*', 'node:*/*'],
					message: 'Import the bare module (`path`, not `node:path`) so a bundler can swap it for a browser polyfill.'
				}]
			}],

			/* a hand-picked part of unicorn: the shapes with a clearer equivalent, not its opinions on naming or style */
			...Object.fromEntries([
				'prefer-array-some', 'prefer-array-index-of', 'prefer-includes',
				/* `prefer-array-flat` is left out: it rewrites `.flatMap(f => f)` on an iterator, which has no `.flat()` */
				'no-unnecessary-array-flat-depth',
				'prefer-string-slice', 'prefer-string-starts-ends-with', 'prefer-regexp-test',
				'prefer-set-size', 'prefer-native-coercion-functions',
				'no-useless-spread', 'no-useless-length-check', 'no-array-push-push',
				'no-instanceof-builtins', 'no-single-promise-in-promise-methods',
				'throw-new-error', 'error-message', 'prefer-optional-catch-binding'
			].map(rule => [`unicorn/${rule}`, 'error'])),

			'@stylistic/object-curly-spacing': ['error', 'always', { emptyObjects: 'never' }],
			'@stylistic/comma-spacing':        ['error', { before: false, after: true }],
			'@stylistic/indent':               ['error', 'tab', {
				FunctionDeclaration: { parameters: 'first' },
				ObjectExpression:    1,
				SwitchCase:          1
			}],
			'@stylistic/padding-line-between-statements': [
				'error',
				{ blankLine: 'never', prev: 'import', next: 'import' }
			],
			'@stylistic/comma-dangle': ['error', 'only-multiline'],
			'@stylistic/quotes':       ['error', 'single', { avoidEscape: true }],

			'jsdoc/check-alignment':           'error',
			'jsdoc/check-indentation':         'off',
			'jsdoc/no-types':                  'error',
			'jsdoc/no-undefined-types':        'off',
			'jsdoc/check-tag-names':           'off',
			'jsdoc/require-param':             'off',
			'jsdoc/require-description':       'off',
			'jsdoc/require-param-description': 'off',
			'jsdoc/require-returns':           'off',
			'jsdoc/require-property':          'off',
			'jsdoc/require-throws':            'off',
			'jsdoc/require-throws-type':       'off',
			'jsdoc/require-file-overview':     'off',
			'jsdoc/check-param-names':         'off',
			'jsdoc/require-jsdoc':             ['error', {
				publicOnly:   true,
				checkGetters: false,
				checkSetters: false,
				require:      { FunctionDeclaration: true }
			}],
			'jsdoc/require-param-type':    'off',
			'jsdoc/require-returns-type':  'off',
			'jsdoc/require-property-type': 'off',
			'jsdoc/require-yields-type':   'off',
			'jsdoc/require-next-type':     'off',
			'jsdoc/require-yields':        'off',

			'@stylistic/no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
			'no-warning-comments':                 ['error', {
				terms:    ['todo', 'fixme', 'xxx'],
				location: 'anywhere'
			}],

			'@typescript-eslint/non-nullable-type-assertion-style': 'off',
			'@typescript-eslint/no-unsafe-enum-comparison':         'off',
			'@typescript-eslint/no-redundant-type-constituents':    'off',
			'@typescript-eslint/consistent-type-assertions':        ['error', { assertionStyle: 'as' }],
			'@typescript-eslint/no-unnecessary-type-assertion':     ['error', { typesToIgnore: ['never'] }],
			/* bit-flag enums may spell their members as shifts, so the bit is the number you read */
			'@typescript-eslint/prefer-literal-enum-member':        ['error', { allowBitwiseExpressions: true }],

			'@stylistic/key-spacing':                 ['error', { align: 'value' }],
			'@stylistic/no-tabs':                     ['error', { allowIndentationTabs: true }],
			'@stylistic/semi':                        ['error', 'always', { omitLastInOneLineBlock: true }],
			'@stylistic/space-before-function-paren': ['error', 'never'],
			'@stylistic/keyword-spacing':             ['error', {
				before:    true,
				after:     true,
				overrides: {
					if:      { after: false },
					for:     { after: false },
					while:   { after: false },
					do:      { after: false },
					catch:   { after: false },
					switch:  { after: false },
					default: { after: false },
					throw:   { after: false }
				}
			}],

			'check-file/filename-naming-convention': ['error', {
				'**/*.ts': '?(\\d+-)?([A-Z])+([a-z])*((-|.)?([A-Z])+([a-z]))'
			}],
			'check-file/folder-match-with-fex': ['error', {
				'*.spec.{js,jsx,ts,tsx}': 'test/**'
			}],

			'@stylistic/no-trailing-spaces': 'error',
			'@stylistic/space-infix-ops':    ['error', { int32Hint: false }],

			'@typescript-eslint/no-unused-vars': 'off',
			'unused-imports/no-unused-imports':  'error',
			'unused-imports/no-unused-vars':     ['error', {
				vars:              'all',
				varsIgnorePattern: '^_',
				args:              'after-used',
				argsIgnorePattern: '^_'
			}],

			'tsdoc/syntax': 'error',

			'@typescript-eslint/naming-convention': ['error',
				{
					selector:           'variable',
					modifiers:          ['const', 'global', 'exported'],
					format:             ['camelCase', 'PascalCase', 'UPPER_CASE'],
					leadingUnderscore:  'allow',
					trailingUnderscore: 'allow'
				},
				{
					selector:           'variable',
					modifiers:          ['const'],
					format:             ['camelCase', 'PascalCase'],
					leadingUnderscore:  'allow',
					trailingUnderscore: 'allow'
				},
				{
					selector:           'enumMember',
					format:             ['StrictPascalCase'],
					leadingUnderscore:  'forbid',
					trailingUnderscore: 'forbid'
				},
				{
					selector: 'typeLike',
					format:   ['PascalCase']
				}
			],
			'@typescript-eslint/consistent-type-imports': ['error', {
				prefer:                  'type-imports',
				disallowTypeAnnotations: false,
				fixStyle:                'separate-type-imports'
			}],
			'@typescript-eslint/no-import-type-side-effects': 'error',
			'@typescript-eslint/consistent-type-exports':     'error',

			curly: 'error',

			'@stylistic/type-annotation-spacing': ['error', {
				before:    false,
				after:     true,
				overrides: { arrow: 'ignore' }
			}],
			'@stylistic/arrow-spacing': ['error', { before: true, after: true }],
			'@stylistic/brace-style':   ['error', '1tbs'],
			'@stylistic/new-parens':    'error',

			'import-x/no-duplicates': ['error', {
				considerQueryString: true,
				'prefer-inline':     false
			}],

			'@typescript-eslint/no-invalid-void-type': ['error', {
				allowInGenericTypeArguments: true,
				allowAsThisParameter:        true
			}]
		}
	}
];

export = config;
