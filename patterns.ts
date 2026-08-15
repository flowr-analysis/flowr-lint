/**
 * Default patterns of `flowr/replacement-pattern`, see the README for the format.
 * The helpers they point at live in flowR: `DfEdge` in `dataflow/graph/edge`, the vertex helpers in
 * `dataflow/graph/vertex`, and `NoEdges` in `dataflow/graph/graph`.
 */

import type { ReplacementPattern } from './pattern-type';

const EDGE = 'dataflow/graph/edge';
const VERTEX = 'dataflow/graph/vertex';
const GRAPH = 'dataflow/graph/graph';

/** `x.types` under the given path */
const types = (prefix: string): string => `[${prefix}.type="MemberExpression"][${prefix}.computed=false][${prefix}.property.name="types"]`;
/** `x.tag` under the given path */
const tag = (prefix: string): string => `[${prefix}.computed=false][${prefix}.property.name="tag"]`;
/** `EdgeType.<Member>` / `VertexType.<Member>` on the right */
const rightIs = (name: string): string => `[right.type="MemberExpression"][right.computed=false][right.object.name="${name}"]`;
/** compared against the literal `0`, either for "some bit is set" or for "none is" */
const versusZero = (nonZero: boolean): string => `BinaryExpression[operator=${nonZero ? '/^(!==|>)$/' : '"==="'}][right.type="Literal"][right.value=0]`;
/** the `x.types & T` on the left of such a comparison */
const mask = '[left.type="BinaryExpression"][left.operator="&"]';
/** a call of `<prefix>.<property>(...)` */
const call = (prefix: string, property: string): string => `[${prefix}.type="CallExpression"][${prefix}.callee.type="MemberExpression"][${prefix}.callee.property.name="${property}"]`;

const destructuringHint = ' Prefer keeping the edge over destructuring `types`, the helpers take it directly and the wrapper object goes away.';

/** `x.types === T`, on the edge itself or on a destructured `types` */
const edgeIsOnly = (id: string, { negated = false, destructured = false } = {}): ReplacementPattern => ({
	id,
	selector: `BinaryExpression[operator="${negated ? '!==' : '==='}"]`
		+ (destructured ? `[left.type="Identifier"][left.name="types"]${rightIs('EdgeType')}` : `${types('left')}:not([right.type="Literal"])`),
	capture:    destructured ? { type: 'right' } : { edge: 'left.object', type: 'right' },
	replace:    `${negated ? '!' : ''}DfEdge.isOnlyType(${destructured ? '{ types }' : '{{edge}}'}, {{type}})`,
	declaredIn: destructured ? { 'right.object': EDGE } : { 'left.property': EDGE },
	message:    `\`${destructured ? '' : 'x.'}types ${negated ? '!==' : '==='} T\` `
		+ (negated ? 'holds as soon as any other type is set' : 'holds only if T is the *only* type')
		+ `; say so with \`${negated ? '!' : ''}DfEdge.isOnlyType\`, or use \`DfEdge.${negated ? 'doesNotIncludeType' : 'includesType'}\` for "${negated ? 'has not' : 'has'} this type".`
		+ (destructured ? destructuringHint : '')
});

/** `(x.types & T) !== 0` and its inverse */
const edgeMask = (id: string, helper: string, nonZero: boolean): ReplacementPattern => ({
	id,
	selector:   `${versusZero(nonZero)}${mask}${types('left.left')}`,
	capture:    { edge: 'left.left.object', type: 'left.right' },
	replace:    `DfEdge.${helper}({{edge}}, {{type}})`,
	declaredIn: { 'left.left.property': EDGE },
	message:    `Use \`DfEdge.${helper}\` instead of testing the bitmask by hand.`
});

/** `x.types !== 0`, the literal-0 comparisons {@link edgeIsOnly} leaves out */
const edgeStates = (id: string, helper: string, what: string, nonZero: boolean): ReplacementPattern => ({
	id,
	selector:   `${versusZero(nonZero)}${types('left')}`,
	capture:    { edge: 'left.object' },
	replace:    `DfEdge.${helper}({{edge}})`,
	declaredIn: { 'left.property': EDGE },
	message:    `Use \`DfEdge.${helper}\` to ask whether the edge states ${what}.`
});

/** `v.tag === VertexType.X`, with `{{type|last}}` spelling the name of the matching helper */
const vertexIs = (id: string, { negated = false, optional = false } = {}): ReplacementPattern => {
	const vertex = optional ? 'left.expression.object' : 'left.object';
	const left = optional ? 'left.expression' : 'left';
	return {
		id,
		selector:   `BinaryExpression[operator="${negated ? '!==' : '==='}"][left.type="${optional ? 'ChainExpression' : 'MemberExpression'}"]${tag(left)}${rightIs('VertexType')}`,
		capture:    { vertex, type: 'right' },
		replace:    `${negated ? '!' : ''}{{type|last}}Vertex.is({{vertex}})`,
		declaredIn: { [`${left}.property`]: VERTEX, 'right.object': VERTEX },
		message:    'Compare through the vertex helper (`{{type|last}}Vertex.is`), it narrows the type as well.'
	};
};

/** `FunctionCallVertex.is(v) && v.origin.includes(T)`, the body of `hasOrigin` written out */
const hasOrigin = (id: string): ReplacementPattern => ({
	id,
	selector: 'LogicalExpression[operator="&&"]'
		+ `${call('left', 'is')}[left.callee.object.name="FunctionCallVertex"]`
		+ `${call('right', 'includes')}[right.callee.object.type="MemberExpression"][right.callee.object.property.name="origin"]`,
	capture:    { vertex: 'left.arguments.0', origin: 'right.arguments.0' },
	replace:    'FunctionCallVertex.hasOrigin({{vertex}}, {{origin}})',
	declaredIn: { 'left.callee.object': VERTEX, 'right.callee.object.property': VERTEX },
	sameText:   [['left.arguments.0', 'right.callee.object.object']],
	/* `hasOrigin` is no type predicate, so the replacement can drop a narrowing the code below relies on */
	fix:        false,
	message:    'Use `FunctionCallVertex.hasOrigin`, it is exactly this check. Check the narrowing first, `hasOrigin` returns a plain boolean.'
});

const patterns: readonly ReplacementPattern[] = [
	edgeIsOnly('edge-is-only-type'),
	edgeIsOnly('edge-is-not-only-type', { negated: true }),
	edgeIsOnly('edge-is-only-type-destructured', { destructured: true }),
	edgeIsOnly('edge-is-not-only-type-destructured', { negated: true, destructured: true }),
	edgeStates('edge-has-any-type', 'hasAnyType', 'anything', true),
	edgeStates('edge-has-no-type', 'hasNoType', 'nothing', false),
	edgeMask('edge-includes-type', 'includesType', true),
	edgeMask('edge-does-not-include-type', 'doesNotIncludeType', false),
	{
		id:         'edge-includes-type-truthy',
		selector:   `:matches(IfStatement, ConditionalExpression, WhileStatement, DoWhileStatement, LogicalExpression, UnaryExpression[operator="!"], ArrowFunctionExpression) > BinaryExpression[operator="&"]${types('left')}`,
		capture:    { edge: 'left.object', type: 'right' },
		replace:    'DfEdge.includesType({{edge}}, {{type}})',
		declaredIn: { 'left.property': EDGE },
		message:    'Do not rely on the bitmask being truthy, `DfEdge.includesType` says what is meant.'
	},
	hasOrigin('vertex-has-origin'),
	{
		/* the `[]` fallback allocates on every miss, and these sit in traversal loops */
		id:         'graph-edges-no-alloc',
		selector:   'LogicalExpression[operator="??"][right.type="ArrayExpression"][right.elements.length=0][left.type="CallExpression"][left.callee.type="MemberExpression"][left.callee.property.name=/^(outgoingEdges|ingoingEdges)$/]',
		capture:    { edges: 'left' },
		replace:    '{{edges}} ?? NoEdges',
		declaredIn: { 'left.callee.property': GRAPH },
		message:    'The `[]` fallback allocates on every miss, use the shared `NoEdges`.'
	},
	vertexIs('vertex-is'),
	vertexIs('vertex-is-not', { negated: true }),
	vertexIs('vertex-is-optional', { optional: true }),
	vertexIs('vertex-is-not-optional', { negated: true, optional: true })
];

export = patterns;
