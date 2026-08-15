import path from 'path';
import assert from 'assert';
import { describe, it, test } from 'node:test';
import type { Rule } from 'eslint';
import { Linter, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import type { ReplacementPattern } from '../pattern-type.js';
import defaults from '../patterns.js';
import useInstead from '../rules/use-instead.js';
import replacementPattern from '../rules/replacement-pattern.js';
import { declarationFile, symbolOf, typeServices } from '../rules/util.js';

/*
 * typescript-eslint picks its TypeScript program strategy from the environment, and `CI=true` (set by
 * GitHub Actions) picks a different one than a developer machine does. Pinning it here means a local run
 * takes the same path as the pipeline, so a setup that only breaks on CI breaks on the desk as well.
 * The parser reads this per parse, not on import, so the assignment lands early enough.
 */
process.env.CI = 'true';

/* `npm test` runs from the package root, so the fixtures are addressed from there */
/* report every case through `node --test` instead of collapsing the file into one test */
const oneLine = (title: string): string => title.replace(/\s+/g, ' ').trim();
RuleTester.describe = (title: string, fn: () => void) => describe(oneLine(title), fn);
RuleTester.it = (title: string, fn: () => void) => it(oneLine(title), fn);

const tsconfigRootDir = path.resolve('test/fixtures');
const filename = path.join(tsconfigRootDir, 'file.ts');

/*
 * The type-aware cases hand the parser a snippet under the name of a fixture that also exists on disk.
 * Only the watch program feeds that snippet into the TypeScript program; the single-run program reads
 * the file from disk instead, so every type-aware rule would quietly see `file.ts` and report nothing.
 * typescript-eslint infers a single run whenever `CI=true` is set, which is exactly what GitHub Actions
 * does, so the inference is switched off here rather than left to the environment.
 */
const parserOptions = { project: './tsconfig.json', tsconfigRootDir, disallowAutomaticSingleRunInference: true };

const typed = new RuleTester({
	languageOptions: {
		parser: tsParser,
		parserOptions
	}
});
const plain = new RuleTester();

/*
 * Guards the parser options above. Without them the type-aware suites report nothing, every `valid` case
 * still passes, and only the `invalid` ones give it away — so the setup is checked head-on instead.
 */
test('the type-aware setup reaches the code under test', () => {
	const seen: { text?: string, declaredIn?: string } = {};
	const probe: Rule.RuleModule = {
		create(context) {
			const services = typeServices(context);
			const checker = services?.program.getTypeChecker();
			return {
				MemberExpression(node): void {
					seen.text = context.sourceCode.getText();
					seen.declaredIn = services && checker ? declarationFile(symbolOf(node.property, services, checker)) : undefined;
				}
			};
		}
	};
	const code = 'import type { Edge } from "./graph-edge";\ndeclare const e: Edge;\nconst a = e.types === 1;';
	const fatal = new Linter().verify(code, {
		files:           ['**/*.ts'],
		plugins:         { flowr: { rules: { probe } } },
		languageOptions: { parser: tsParser, parserOptions },
		rules:           { 'flowr/probe': 'error' }
	}, filename).filter(m => m.fatal);

	assert.deepStrictEqual(fatal, [], 'the fixture must parse');
	/* a single-run program hands out the fixture on disk instead, and `e.types` is not in it */
	assert.strictEqual(seen.text, code, 'the parser must see the code under test, not the fixture on disk');
	assert.match(seen.declaredIn ?? '', /graph-edge\.ts$/, 'the type checker must resolve the declaring module');
});

const edgeIsOnlyType: ReplacementPattern = {
	id:       'edge-is-only-type',
	selector: 'BinaryExpression[operator="==="][left.type="MemberExpression"][left.property.name="types"]',
	capture:  { edge: 'left.object', type: 'right' },
	replace:  'DfEdge.isOnlyType({{edge}}, {{type}})',
	message:  'Use `DfEdge.isOnlyType` here.'
};
const vertexIs: ReplacementPattern = {
	id:       'vertex-is',
	selector: 'BinaryExpression[operator="==="][left.property.name="tag"][right.object.name="VertexType"]',
	capture:  { vertex: 'left.object', type: 'right' },
	replace:  '{{type|last}}Vertex.is({{vertex}})',
	message:  'Use `{{type|last}}Vertex.is` here.'
};
const options = (patterns: readonly ReplacementPattern[]): [{ patterns: readonly ReplacementPattern[] }] => [{ patterns }];

plain.run('replacement-pattern', replacementPattern, {
	valid: [
		{ name: 'another property does not match', code: 'const a = edge.other === EdgeType.Reads;', options: options([edgeIsOnlyType]) },
		{ name: 'no patterns, no reports', code: 'const a = edge.types === EdgeType.Reads;', options: options([]) },
		{
			name:    '`@performanceCritical` silences it',
			code:    '/**\n * @performanceCritical\n */\nfunction f() { return edge.types === EdgeType.Reads; }',
			options: options([edgeIsOnlyType])
		},
		{
			name:    '`@lintIgnore` with the pattern id silences it',
			code:    '/**\n * @lintIgnore edge-is-only-type\n */\nfunction f() { return edge.types === EdgeType.Reads; }',
			options: options([edgeIsOnlyType])
		}
	],
	invalid: [
		{
			name:    'a different id does not silence this pattern',
			code:    '/**\n * @lintIgnore edge-includes-type\n */\nfunction f() { return edge.types === EdgeType.Reads; }',
			options: options([edgeIsOnlyType]),
			errors:  1
		},
		{
			name:    'reports and suggests the helper',
			code:    'const a = edge.types === EdgeType.Reads;',
			options: options([edgeIsOnlyType]),
			errors:  [{
				message:     'Use `DfEdge.isOnlyType` here.',
				suggestions: [{
					desc:   'Replace with `DfEdge.isOnlyType(edge, EdgeType.Reads)`.',
					output: 'const a = DfEdge.isOnlyType(edge, EdgeType.Reads);'
				}]
			}]
		},
		{
			name:    '`{{type|last}}` names the matching helper',
			code:    'const a = vertex.tag === VertexType.FunctionCall;',
			options: options([vertexIs]),
			errors:  [{
				message:     'Use `FunctionCallVertex.is` here.',
				suggestions: [{
					desc:   'Replace with `FunctionCallVertex.is(vertex)`.',
					output: 'const a = FunctionCallVertex.is(vertex);'
				}]
			}]
		},
		{
			name:    'fixed when the helper is in scope',
			code:    'const DfEdge = {};\nconst a = edge.types === EdgeType.Reads;',
			options: options([edgeIsOnlyType]),
			output:  'const DfEdge = {};\nconst a = DfEdge.isOnlyType(edge, EdgeType.Reads);',
			errors:  1
		},
		{
			name:    '`fix: true` forces the fix',
			code:    'const a = edge.types === EdgeType.Reads;',
			options: options([{ ...edgeIsOnlyType, fix: true }]),
			output:  'const a = DfEdge.isOnlyType(edge, EdgeType.Reads);',
			errors:  1
		},
		{
			name:    'a tag covers its declaration, not the file',
			code:    '/**\n * @performanceCritical\n */\nfunction f() { return edge.types === EdgeType.Reads; }\nfunction g() { return edge.types === EdgeType.Calls; }',
			options: options([edgeIsOnlyType]),
			errors:  1
		}
	]
});

const declaredIn: ReplacementPattern = { ...edgeIsOnlyType, declaredIn: { 'left.property': 'graph-edge' } };

typed.run('replacement-pattern (declaredIn)', replacementPattern, {
	valid: [{
		name:     'the same shape from another module',
		code:     'import type { Edge } from "./other";\ndeclare const e: Edge;\nconst a = e.types === 1;',
		filename,
		options:  options([declaredIn])
	}],
	invalid: [{
		name:     'the shape from the declaring module',
		code:     'import type { Edge } from "./graph-edge";\ndeclare const e: Edge;\nconst a = e.types === 1;',
		filename,
		options:  options([declaredIn]),
		errors:   1
	}]
});

typed.run('use-instead', useInstead, {
	valid: [
		{
			name:     'the helper object may wire it up',
			code:     'import { legacy } from "./graph-edge";\nexport const Wrapper = { modern: legacy };',
			filename
		},
		{
			name:     '`@lintIgnore` in the file header',
			code:     '/**\n * @lintIgnore use-instead\n */\nimport { legacy } from "./graph-edge";\nexport const a = legacy(1);',
			filename
		},
		{
			name:     '`@performanceCritical` on the using function',
			code:     'import { legacy } from "./graph-edge";\n/** @performanceCritical */\nexport function f() { return legacy(1); }',
			filename
		}
	],
	invalid: [
		{
			name:     'suggested when the helper is not in scope',
			code:     'import { legacy } from "./graph-edge";\nexport const a = legacy(1);',
			filename,
			errors:   [{
				message:     'Do not use `legacy` directly, use `Helper.modern` instead.',
				suggestions: [{
					desc:   'Replace with `Helper.modern`.',
					output: 'import { legacy } from "./graph-edge";\nexport const a = Helper.modern(1);'
				}]
			}]
		},
		{
			name:     'fixed when the helper is imported',
			code:     'import { Helper, legacy } from "./graph-edge";\nexport const a = legacy(1) + Helper.modern(2);',
			filename,
			output:   'import { Helper, legacy } from "./graph-edge";\nexport const a = Helper.modern(1) + Helper.modern(2);',
			errors:   [{ message: 'Do not use `legacy` directly, use `Helper.modern` instead.' }]
		},
		{
			name:     'the tag is read on a helper member',
			code:     'import { Legacy } from "./graph-edge";\nexport const a = Legacy.old(1);',
			filename,
			errors:   [{
				message:     'Do not use `Legacy.old` directly, use `Helper.modern` instead.',
				suggestions: [{
					desc:   'Replace with `Helper.modern`.',
					output: 'import { Legacy } from "./graph-edge";\nexport const a = Helper.modern(1);'
				}]
			}]
		}
	]
});

/* every default pattern, so a broken selector shows up as a missing suggestion */
const shapes = [
	['e.types === EdgeType.Reads',        'DfEdge.isOnlyType(e, EdgeType.Reads)'],
	['e.types !== EdgeType.Reads',        '!DfEdge.isOnlyType(e, EdgeType.Reads)'],
	['types === EdgeType.Reads',          'DfEdge.isOnlyType({ types }, EdgeType.Reads)'],
	['types !== EdgeType.Reads',          '!DfEdge.isOnlyType({ types }, EdgeType.Reads)'],
	['e.types !== 0',                     'DfEdge.hasAnyType(e)'],
	['e.types > 0',                       'DfEdge.hasAnyType(e)'],
	['e.types === 0',                     'DfEdge.hasNoType(e)'],
	['(e.types & EdgeType.Reads) !== 0',  'DfEdge.includesType(e, EdgeType.Reads)'],
	['(e.types & EdgeType.Reads) > 0',    'DfEdge.includesType(e, EdgeType.Reads)'],
	['(e.types & EdgeType.Reads) === 0',  'DfEdge.doesNotIncludeType(e, EdgeType.Reads)'],
	['!(e.types & EdgeType.Reads)',       'DfEdge.includesType(e, EdgeType.Reads)'],
	['v.tag === VertexType.Use',          'UseVertex.is(v)'],
	['v.tag !== VertexType.Use',          '!UseVertex.is(v)'],
	['o?.tag === VertexType.FunctionCall', 'FunctionCallVertex.is(o)'],
	['o?.tag !== VertexType.FunctionCall', '!FunctionCallVertex.is(o)'],
	['FunctionCallVertex.is(v) && v.origin.includes("x")', 'FunctionCallVertex.hasOrigin(v, "x")'],
	['g.outgoingEdges(1) ?? []',           'g.outgoingEdges(1) ?? NoEdges']
];

/* `sameText` keeps the two halves apart, esquery alone cannot see that they name different vertices */
const notReported = 'FunctionCallVertex.is(v) && w.origin.includes("x")';

const code = [
	'import { EdgeType, type DfEdge } from "./dataflow/graph/edge";',
	'import { VertexType, FunctionCallVertex, type Vertex } from "./dataflow/graph/vertex";',
	'import { NoEdges, type Graph } from "./dataflow/graph/graph";',
	'declare const e: DfEdge, v: Vertex, w: Vertex, o: Vertex | undefined, g: Graph;',
	'const { types } = e;',
	'export const checks = [',
	...shapes.map(([shape]) => `\t${shape},`),
	`\t${notReported}`,
	'];'
].join('\n');

test('every default pattern reports its replacement', () => {
	const reported = new Linter().verify(code, {
		files:           ['**/*.ts'],
		plugins:         { flowr: { rules: { 'replacement-pattern': replacementPattern } } },
		languageOptions: { parser: tsParser, parserOptions },
		rules:           { 'flowr/replacement-pattern': ['error', { patterns: defaults }] }
	}, filename);

	assert.deepStrictEqual(
		/* a report either carries the fix outright or offers it as a suggestion, both spell the replacement */
		reported.map(m => (m.suggestions?.[0] as { data?: { replacement?: string } } | undefined)?.data?.replacement ?? m.fix?.text),
		shapes.map(([, replacement]) => replacement)
	);
});
