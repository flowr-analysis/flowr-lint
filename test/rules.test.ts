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
import fileNaming from '../rules/file-naming.js';
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
void test('the type-aware setup reaches the code under test', () => {
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
	replace:  'DfgVertex.is{{type|last}}({{vertex}})',
	message:  'Use `DfgVertex.is{{type|last}}` here.'
};
const options = (patterns: readonly ReplacementPattern[]): [{ patterns: readonly ReplacementPattern[] }] => [{ patterns }];

plain.run('file-naming', fileNaming, {
	valid: [
		{ code: '', filename: 'src/dataflow-graph.ts' },
		{ code: '', filename: 'src/1-setup.Vertex.ts' },
		{ code: '', filename: 'test/r-bridge.test.ts' },
		{ code: '', filename: 'test/unit/my.spec.ts' }
	],
	invalid: [
		{ code: '', filename: 'src/dataflowGraph.ts', errors: [{ messageId: 'name' }] },
		{ code: '', filename: 'src/vertex2.ts', errors: [{ messageId: 'name' }] },
		{ code: '', filename: 'src/my.spec.ts', errors: [{ messageId: 'spec' }] }
	]
});

plain.run('replacement-pattern', replacementPattern, {
	valid: [
		{ name: 'another property does not match', code: 'const a = edge.other === EdgeType.Reads;', options: options([edgeIsOnlyType]) },
		{ name: 'no patterns, no reports', code: 'const a = edge.types === EdgeType.Reads;', options: options([]) },
		{
			name:    '`@lintIgnore` without ids silences it',
			code:    '/**\n * @lintIgnore\n */\nfunction f() { return edge.types === EdgeType.Reads; }',
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
			name:    '`{{type|last}}` names the matching helper member',
			code:    'const a = vertex.tag === VertexType.FunctionCall;',
			options: options([vertexIs]),
			errors:  [{
				message:     'Use `DfgVertex.isFunctionCall` here.',
				suggestions: [{
					desc:   'Replace with `DfgVertex.isFunctionCall(vertex)`.',
					output: 'const a = DfgVertex.isFunctionCall(vertex);'
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
			code:    '/**\n * @lintIgnore\n */\nfunction f() { return edge.types === EdgeType.Reads; }\nfunction g() { return edge.types === EdgeType.Calls; }',
			options: options([edgeIsOnlyType]),
			errors:  1
		}
	]
});

const declaredIn: ReplacementPattern = { ...edgeIsOnlyType, declaredIn: { 'left.property': 'graph-edge' } };

typed.run('replacement-pattern (declaredIn)', replacementPattern, {
	valid: [{
		name:    'the same shape from another module',
		code:    'import type { Edge } from "./other";\ndeclare const e: Edge;\nconst a = e.types === 1;',
		filename,
		options: options([declaredIn])
	}],
	invalid: [{
		name:    'the shape from the declaring module',
		code:    'import type { Edge } from "./graph-edge";\ndeclare const e: Edge;\nconst a = e.types === 1;',
		filename,
		options: options([declaredIn]),
		errors:  1
	}]
});

typed.run('use-instead', useInstead, {
	valid: [
		{
			name: 'the helper object may wire it up',
			code: 'import { legacy } from "./graph-edge";\nexport const Wrapper = { modern: legacy };',
			filename
		},
		{
			name: '`@lintIgnore` in the file header',
			code: '/**\n * @lintIgnore use-instead\n */\nimport { legacy } from "./graph-edge";\nexport const a = legacy(1);',
			filename
		},
		{
			name: '`@lintIgnore` on the using function',
			code: 'import { legacy } from "./graph-edge";\n/** @lintIgnore use-instead */\nexport function f() { return legacy(1); }',
			filename
		}
	],
	invalid: [
		{
			name:   'suggested when the helper is not in scope',
			code:   'import { legacy } from "./graph-edge";\nexport const a = legacy(1);',
			filename,
			errors: [{
				message:     'Do not use `legacy` directly, use `Helper.modern` instead.',
				suggestions: [{
					desc:   'Replace with `Helper.modern`.',
					output: 'import { legacy } from "./graph-edge";\nexport const a = Helper.modern(1);'
				}]
			}]
		},
		{
			name:   'fixed when the helper is imported',
			code:   'import { Helper, legacy } from "./graph-edge";\nexport const a = legacy(1) + Helper.modern(2);',
			filename,
			output: 'import { Helper, legacy } from "./graph-edge";\nexport const a = Helper.modern(1) + Helper.modern(2);',
			errors: [{ message: 'Do not use `legacy` directly, use `Helper.modern` instead.' }]
		},
		{
			name:   'the tag is read on a helper member',
			code:   'import { Legacy } from "./graph-edge";\nexport const a = Legacy.old(1);',
			filename,
			errors: [{
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
	['v.tag === VertexType.Use',          'DfgVertex.isUse(v)'],
	['v.tag !== VertexType.Use',          '!DfgVertex.isUse(v)'],
	['o?.tag === VertexType.FunctionCall', 'DfgVertex.isFunctionCall(o)'],
	['o?.tag !== VertexType.FunctionCall', '!DfgVertex.isFunctionCall(o)'],
	['DfgVertex.isFunctionCall(v) && v.origin.includes("x")', 'DfgVertex.hasOrigin(v, "x")'],
	['g.outgoingEdges(1) ?? []',           'g.edgesFrom(1)'],
	['g.outgoingEdges(1) ?? NoEdges',      'g.edgesFrom(1)'],
	['g.ingoingEdges(1) ?? NoEdges',       'g.edgesTo(1)'],
	['SourceRange.getStartLine(SourceLocation.getRange(loc))', 'SourceLocation.getStartLine(loc)'],
	['SourceLocation.fromNode(node) ?? []',  'SourceLocation.at(node)'],
	['loc === undefined ? undefined : SourceLocation.getStartLine(loc)', 'SourceLocation.getStartLine(loc)'],
	['Identifier.toString(id ?? "")',      'Identifier.toString(id)'],
	['n.type === RType.Symbol',            'RSymbol.is(n)'],
	['n.type !== RType.Symbol',            '!RSymbol.is(n)'],
	['m?.type === RType.FunctionCall',     'RFunctionCall.is(m)'],
	['m?.type !== RType.FunctionCall',     '!RFunctionCall.is(m)'],
	['RFunctionCall.is(n) && n.named',     'RFunctionCall.isNamed(n)'],
	['RFunctionCall.is(n) && n.named === true', 'RFunctionCall.isNamed(n)'],
	['RFunctionCall.is(n) && !n.named',    'RFunctionCall.isUnnamed(n)'],
	['RFunctionCall.isNamed(c) && Identifier.getName(c.functionName.content) === "f"', 'RFunctionCall.isNamed(c, "f")'],
	['!RFunctionCall.isNamed(c) || Identifier.getName(c.functionName.content) !== "f"', '!RFunctionCall.isNamed(c, "f")'],
	['RFunctionCall.isNamed(c) && Identifier.getName(c.functionName.content) === fname', 'RFunctionCall.isNamed(c, fname)'],
	['RFunctionCall.isNamed(c) && fset.has(Identifier.getName(c.functionName.content))', 'RFunctionCall.isNamed(c, fset)'],
	['!RFunctionCall.isNamed(c) || !fset.has(Identifier.getName(c.functionName.content))', '!RFunctionCall.isNamed(c, fset)'],
	['RArgument.is(n) && n.name !== undefined',  'RArgument.isNamed(n)'],
	['RArgument.is(n) && n.value !== undefined', 'RArgument.isWithValue(n)'],
	['RExpressionList.is(n) && n.grouping === undefined', 'RExpressionList.isImplicit(n)'],
	['s.content === "lib"',                'Identifier.getName(s.content) === "lib"'],
	['s.content !== "lib"',                'Identifier.getName(s.content) !== "lib"'],
	['l.reduce((x, y) => x + y, 0)',       'arraySum(l)'],
	['l.filter(p).length > 0',             'l.some(p)'],
	['l.filter(p).length === 0',           '!l.some(p)']
];

/* `sameText` keeps the two halves apart, esquery alone cannot see that the halves name different nodes */
const notReported = [
	'DfgVertex.isFunctionCall(v) && w.origin.includes("x")',
	'RFunctionCall.is(n) && k.named',
	'RArgument.is(n) && k.name !== undefined',
	'RFunctionCall.isNamed(c) && Identifier.getName(d.functionName.content) === "f"',
	'other === undefined ? undefined : SourceLocation.getStartLine(loc)'
];

const code = [
	'import { EdgeType, type DfEdge } from "./dataflow/graph/edge";',
	'import { VertexType, DfgVertex, type Vertex } from "./dataflow/graph/vertex";',
	'import { NoEdges, type Graph } from "./dataflow/graph/graph";',
	'import { SourceRange, SourceLocation } from "./util/range";',
	'import { Identifier } from "./dataflow/environments/identifier";',
	'import { RType } from "./r-bridge/lang-4.x/ast/model/type";',
	'import { RSymbol } from "./r-bridge/lang-4.x/ast/model/nodes/r-symbol";',
	'import { RFunctionCall } from "./r-bridge/lang-4.x/ast/model/nodes/r-function-call";',
	'import { RArgument } from "./r-bridge/lang-4.x/ast/model/nodes/r-argument";',
	'import { RExpressionList } from "./r-bridge/lang-4.x/ast/model/nodes/r-expression-list";',
	'declare const e: DfEdge, v: Vertex, w: Vertex, o: Vertex | undefined, g: Graph;',
	'declare const n: { type: RType }, k: { type: RType }, m: { type: RType } | undefined;',
	'declare const s: RSymbol, l: number[], p: (x: number) => boolean;',
	'declare const loc: SourceLocation | undefined, other: SourceLocation | undefined, id: Identifier | undefined;',
	'declare const node: { info: { id: number } };',
	'declare const c: { type: RType, functionName: { content: Identifier } }, d: { type: RType, functionName: { content: Identifier } };',
	'declare const fs: string[], fset: Set<string>, fname: string;',
	'const { types } = e;',
	'export const checks = [',
	...shapes.map(([shape]) => `\t${shape},`),
	...notReported.map(shape => `\t${shape},`),
	'];'
].join('\n');

void test('every default pattern reports its replacement', () => {
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

/*
 * The helper-adoption patterns are checked one by one: several of them overlap with older ones on purpose
 * (`v.tag === ...` inside a `filter`), and only the pattern under test may speak here.
 */
const header = [
	'import { EdgeType, DfEdge } from "./dataflow/graph/edge";',
	'import { VertexType, DfgVertex, type Vertex } from "./dataflow/graph/vertex";',
	'import type { Graph } from "./dataflow/graph/graph";',
	'import type { Environment } from "./dataflow/environments/environment";',
	'import type { Base } from "./r-bridge/lang-4.x/ast/model/model";',
	'import { RFunctionCall, EmptyArgument, type PotentiallyEmptyRArgument } from "./r-bridge/lang-4.x/ast/model/nodes/r-function-call";',
	'import { RArgument } from "./r-bridge/lang-4.x/ast/model/nodes/r-argument";',
	'declare const nd: Base, nm: Base | undefined, rc: RFunctionCall, idMap: Map<number, Base>, other: Base;',
	'declare const arg: PotentiallyEmptyRArgument, args: PotentiallyEmptyRArgument[], more: PotentiallyEmptyRArgument[];',
	'declare const v: Vertex, w: Vertex, g: Graph, h: Graph, env: { current: Environment }, nodeId: number, types: EdgeType;',
	'declare const str: string, strs: string[], names: string[], moreNames: string[], fullName: string, vertexName: string;',
	'export const check = '
].join('\n');

/** pattern id, the code, and the replacement it has to offer (`undefined` when the code has to stay unreported) */
const adoption: readonly (readonly [id: string, code: string, replacement: string | undefined])[] = [
	['node-lexeme',                 'nd.info.fullLexeme ?? nd.lexeme',                 'RNode.lexeme(nd)'],
	['node-lexeme',                 'nd.info.fullLexeme ?? other.lexeme',              undefined],
	['node-lexeme-optional',        'nm?.info.fullLexeme ?? nm?.lexeme',               'RNode.lexeme(nm)'],
	['node-own-lexeme',             'nd.lexeme ?? nd.info.fullLexeme',                 'RNode.ownLexeme(nd)'],
	['node-own-lexeme',             'nd.lexeme ?? nd.info.fullRange',                  undefined],
	['node-own-lexeme-optional',    'nm?.lexeme ?? nm?.info.fullLexeme',               'RNode.ownLexeme(nm)'],
	['node-range',                  'nd.info.fullRange ?? nd.location',                'SourceRange.fromNode(nd)'],
	['node-range',                  'nd.info.fullRange ?? other.location',             undefined],
	['node-range-optional',         'nm?.info.fullRange ?? nm?.location',              'SourceRange.fromNode(nm)'],
	['node-own-range',              'nd.location ?? nd.info.fullRange',                'SourceRange.ownFromNode(nd)'],
	['node-own-range-optional',     'nm?.location ?? nm?.info.fullRange',              'SourceRange.ownFromNode(nm)'],
	['range-start-line',            'nd.location?.[0]',                                'SourceRange.getStartLine(nd.location)'],
	['range-start-column',          'nm?.location?.[1]',                               'SourceRange.getStartColumn(nm?.location)'],
	['range-end-line',              'nd.info.fullRange?.[2]',                          'SourceRange.getEndLine(nd.info.fullRange)'],
	['range-end-column',            'nd.location?.[3]',                                'SourceRange.getEndColumn(nd.location)'],
	['range-start-line',            'strs?.[0]',                                       undefined],
	['node-id-recover-name',        'idMap.get(nodeId)?.lexeme',                       'NodeId.recoverName(nodeId, idMap)'],
	['node-id-recover-name',        'g.idMap?.get(nodeId)?.lexeme',                    'NodeId.recoverName(nodeId, g.idMap)'],
	['node-id-recover-name',        'idMap.get(nodeId)?.location',                     undefined],
	['unpack-arg',                  'arg === EmptyArgument ? undefined : arg.value',   'RArgument.valueOf(arg)'],
	['unpack-arg',                  'arg === EmptyArgument ? undefined : arg.name',    undefined],
	['unpack-arg-inverted',         'arg !== EmptyArgument ? arg.value : undefined',   'RArgument.valueOf(arg)'],
	['find-named-arg',              'args.find(a => a !== EmptyArgument && a.name?.content === "x")', 'RArgument.findNamed(args, "x")'],
	['find-named-arg',              'args.find(a => a !== EmptyArgument && a.name?.content === fullName)', 'RArgument.findNamed(args, fullName)'],
	['find-named-arg',              'args.find(a => a !== EmptyArgument && more.length > 0 && a.name?.content === "x")', undefined],
	['find-named-arg-not-empty',    'args.find(a => RArgument.isNotEmpty(a) && a.name?.content === "x")', 'RArgument.findNamed(args, "x")'],
	['find-named-arg-negated-empty', 'args.find(a => !RArgument.isEmpty(a) && a.name?.content === "x")', 'RArgument.findNamed(args, "x")'],
	['find-named-arg-negated-empty', 'args.find(a => !RArgument.isEmpty(more[0]) && a.name?.content === "x")', undefined],
	['call-sole-argument',          'args.length === 1 && args[0] !== EmptyArgument ? args[0] : undefined', 'RFunctionCall.soleArgument(args)'],
	['call-sole-argument',          'args.length === 1 && args[0] !== EmptyArgument ? more[0] : undefined', undefined],
	['call-called-name',            'RFunctionCall.isNamed(rc) ? rc.functionName.content : undefined', 'RFunctionCall.calledName(rc)'],
	['call-called-name',            'RFunctionCall.isNamed(rc) ? other.lexeme : undefined', undefined],
	['call-called-name-named',      'rc.named ? rc.functionName.content : undefined',  'RFunctionCall.calledName(rc)'],
	['callee-lexeme-comparison',    'rc.functionName.lexeme === "eval"',               'RFunctionCall.isNamed(rc, "eval")'],
	['callee-lexeme-comparison',    'rc.functionName.lexeme === fullName',             undefined],
	['callee-lexeme-comparison-not', 'rc.functionName.lexeme !== "eval"',              '!RFunctionCall.isNamed(rc, "eval")'],
	['vertex-name-comparison',      'v.name === "library"',                            'Identifier.getName(v.name) === "library"'],
	['vertex-name-comparison',      'vertexName === "library"',                        undefined],
	['vertex-name-comparison-not',  'v.name !== "library"',                            'Identifier.getName(v.name) !== "library"'],
	['vertex-lacks-origin',         '!DfgVertex.isFunctionCall(v) || !v.origin.includes("x")', '!DfgVertex.hasOrigin(v, "x")'],
	['vertex-lacks-origin',         '!DfgVertex.isFunctionCall(v) || !w.origin.includes("x")', undefined],
	['vertex-has-origin-array',     'DfgVertex.isFunctionCall(v) && Array.isArray(v.origin) && v.origin.includes("x")', 'DfgVertex.hasOrigin(v, "x")'],
	['vertex-has-origin-array',     'DfgVertex.isFunctionCall(v) && Array.isArray(w.origin) && v.origin.includes("x")', undefined],
	['vertex-origin-includes',      'v.origin.includes("x")',                          'DfgVertex.hasOrigin(v, "x")'],
	['vertex-origin-includes',      '!v.origin.includes("x")',                         'DfgVertex.hasOrigin(v, "x")'],
	['vertex-origin-includes',      'strs.includes("x")',                              undefined],
	['vertex-origin-includes',      'DfgVertex.isFunctionCall(v) && v.origin.includes("x")', undefined],
	['graph-vertices-of-type',      'g.vertices(true).filter(([, x]) => x.tag === VertexType.Use)', 'g.verticesOfType(VertexType.Use)'],
	['graph-vertices-of-type',      'g.vertices(true).filter(([, x]) => w.tag === VertexType.Use)', undefined],
	['edge-targets',                '[...g.edgesFrom(nodeId)].filter(([, e]) => DfEdge.includesType(e, EdgeType.Reads)).map(([t]) => t)', 'Dataflow.targetsOf(g, nodeId, EdgeType.Reads)'],
	['edge-targets',                '[...g.edgesFrom(nodeId)].filter(([, e]) => DfEdge.includesType(e, EdgeType.Reads)).map(([, e]) => e)', undefined],
	['edge-sources',                '[...g.edgesTo(nodeId)].filter(([, e]) => DfEdge.includesType(e, types)).map(([s]) => s)', 'Dataflow.sourcesOf(g, nodeId, types)'],
	['edge-sources',                '[...g.edgesFrom(nodeId)].filter(([, e]) => DfEdge.includesType(e, types)).map(([s]) => s)', undefined],
	['edge-has-type-between',       'DfEdge.includesType(g.edgesFrom(nodeId).get(nodeId + 1) ?? { types: 0 }, types)', 'Dataflow.hasEdge(g, nodeId, nodeId + 1, types)'],
	['edge-has-type-between',       'DfEdge.includesType(g.edgesFrom(nodeId).get(nodeId + 1) ?? { types: 1 }, types)', undefined],
	['built-in-id-string',          'String(nodeId).startsWith("built-in:")',          'NodeId.isBuiltIn(nodeId)'],
	['built-in-id-string',          'String(nodeId).startsWith("file-")',              undefined],
	['built-in-id-prefix',          'str.startsWith("built-in:")',                     'NodeId.isBuiltIn(str)'],
	['to-built-in-template',        '`built-in:${str}`',                               'NodeId.toBuiltIn(str)'],
	['to-built-in-template',        '`built-in:${str}:${fullName}`',                   undefined],
	['to-built-in-concat',          '"built-in:" + str',                               'NodeId.toBuiltIn(str)'],
	['to-built-in-concat',          '"file-" + str',                                   undefined],
	['remove-r-quotes',             'str.replace(/^["\'`]|["\'`]$/g, "")',             'RString.unquote(str)'],
	['remove-r-quotes',             'str.replace(/^["\'`]|["\'`]$/g, "-")',            undefined],
	['remove-r-quotes',             'str.replace(/^[ ]|[ ]$/g, "")',                   undefined],
	['escape-regex',                'str.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")', 'escapeRegex(str)'],
	['escape-regex',                'str.replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&")',   undefined],
	['identifier-split',            'fullName.split("::")',                            'Identifier.parse(fullName)'],
	['identifier-split',            'str.split("::")',                                 undefined],
	['unique-array',                '[...new Set(strs)]',                              'uniqueArray(strs)'],
	['unique-array',                '[...new Set([...strs, ...names])]',               undefined],
	['unique-array-merge',          '[...new Set([...strs, ...names])]',               'uniqueArrayMerge(strs, names)'],
	['unique-array-merge',          '[...new Set(strs)]',                              undefined],
	['array-equal',                 'strs.length === names.length && strs.every((x, i) => x === names[i])', 'arrayEqual(strs, names)'],
	['array-equal',                 'strs.length === names.length && strs.every((x, i) => x === moreNames[i])', undefined],
	['sort-code-unit',              'strs.sort((a, b) => a.localeCompare(b))',         'strs.sort(compareByCodeUnit)'],
	['sort-code-unit',              'strs.sort((a, b) => b.localeCompare(a))',         undefined],
	/* the helper's own body is where the pattern is written out, a fix there would make it call itself */
	['array-equal',                 'function arrayEqual() { return strs.length === names.length && strs.every((x, i) => x === names[i]); }', undefined],
	['array-equal',                 '({ arrayEqual: () => strs.length === names.length && strs.every((x, i) => x === names[i]) })', undefined],
	['array-equal',                 '({ arrayEqual(): boolean { return strs.length === names.length && strs.every((x, i) => x === names[i]); } })', undefined]
];

const idsOfAdoption = [...new Set(adoption.map(([id]) => id))];

void test('every adoption pattern is covered and has a case in both directions', () => {
	const shipped = new Set(defaults.map(p => p.id));
	for(const id of idsOfAdoption) {
		assert.ok(shipped.has(id), `${id} is not a shipped pattern`);
		assert.ok(adoption.some(([i, , r]) => i === id && r !== undefined), `${id} needs a reported case`);
	}
});

void describe('adoption patterns', () => {
	for(const [id, snippet, replacement] of adoption) {
		const pattern = defaults.filter(p => p.id === id);
		void it(oneLine(`${id}: ${snippet}`), () => {
			const reported = new Linter().verify(`${header}${snippet};\n`, {
				files:           ['**/*.ts'],
				plugins:         { flowr: { rules: { 'replacement-pattern': replacementPattern } } },
				languageOptions: { parser: tsParser, parserOptions },
				rules:           { 'flowr/replacement-pattern': ['error', { patterns: pattern }] }
			}, filename);
			assert.deepStrictEqual(reported.filter(m => m.fatal), [], 'the snippet must parse');
			assert.deepStrictEqual(
				reported.map(m => (m.suggestions?.[0] as { data?: { replacement?: string } } | undefined)?.data?.replacement ?? m.fix?.text),
				replacement === undefined ? [] : [replacement]
			);
		});
	}
});
