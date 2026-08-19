/**
 * Default patterns of `flowr/replacement-pattern`, see the README for the format.
 * The helpers they point at live in flowR: `DfEdge` in `dataflow/graph/edge`, the vertex helpers in
 * `dataflow/graph/vertex`, `NoEdges` in `dataflow/graph/graph`, the `RNode` helpers in
 * `r-bridge/lang-4.x/ast/model`, and the collection helpers in `util/collections`.
 */

import type { ReplacementPattern } from './pattern-type';

const EDGE = 'dataflow/graph/edge';
const VERTEX = 'dataflow/graph/vertex';
const GRAPH = 'dataflow/graph/graph';
const RTYPE = 'r-bridge/lang-4.x/ast/model/type';
const CALL_NODE = 'r-bridge/lang-4.x/ast/model/nodes/r-function-call';
const ARGUMENT_NODE = 'r-bridge/lang-4.x/ast/model/nodes/r-argument';
const SYMBOL_NODE = 'r-bridge/lang-4.x/ast/model/nodes/r-symbol';
const LIST_NODE = 'r-bridge/lang-4.x/ast/model/nodes/r-expression-list';

/** `x.types` under the given path */
const types = (prefix: string): string => `[${prefix}.type="MemberExpression"][${prefix}.computed=false][${prefix}.property.name="types"]`;
/** `x.<name>` under the given path, without asserting the node kind, which the caller pins down */
const member = (prefix: string, name: string): string => `[${prefix}.computed=false][${prefix}.property.name="${name}"]`;
/** `EdgeType.<Member>` / `VertexType.<Member>` / `RType.<Member>` on the right */
const rightIs = (name: string): string => `[right.type="MemberExpression"][right.computed=false][right.object.name="${name}"]`;
/** compared against the literal `0`, either for "some bit is set" or for "none is" */
const versusZero = (nonZero: boolean): string => `BinaryExpression[operator=${nonZero ? '/^(!==|>)$/' : '"==="'}][right.type="Literal"][right.value=0]`;
/** the `x.types & T` on the left of such a comparison */
const mask = '[left.type="BinaryExpression"][left.operator="&"]';
/** a call of `<prefix>.<property>(...)` */
const call = (prefix: string, property: string): string => `[${prefix}.type="CallExpression"][${prefix}.callee.type="MemberExpression"][${prefix}.callee.property.name="${property}"]`;
/** a call of `<Helper>.<property>(<one argument>)` under the given path */
const helperCall = (prefix: string, helper: string, property: string): string =>
	`${call(prefix, property)}[${prefix}.callee.object.name="${helper}"][${prefix}.arguments.length=1]`;
/** `x === undefined` / `x !== undefined` under the given path */
const versusUndefined = (prefix: string, set: boolean): string =>
	`[${prefix}.type="BinaryExpression"][${prefix}.operator="${set ? '!==' : '==='}"][${prefix}.right.type="Identifier"][${prefix}.right.name="undefined"]`;

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

/**
 * A discriminator compared against its enum, `v.tag === VertexType.X` and `n.type === RType.X`.
 * `optional` covers the `?.` spelling, which parses as a chain around the same member expression.
 * `declaring` maps a path of the match to the file its symbol has to come from; the enum on the right is
 * always pinned, the property on the left only where one file declares it for every case.
 */
const discriminatorIs = (
	id: string,
	{ property, enumName, enumFile, propertyFile, helper, hint }:
	{ property: string, enumName: string, enumFile: string, propertyFile?: string, helper: string, hint: string },
	{ negated = false, optional = false } = {}
): ReplacementPattern => {
	const left = optional ? 'left.expression' : 'left';
	return {
		id,
		selector:   `BinaryExpression[operator="${negated ? '!==' : '==='}"][left.type="${optional ? 'ChainExpression' : 'MemberExpression'}"]${member(left, property)}${rightIs(enumName)}`,
		capture:    { subject: `${left}.object`, type: 'right' },
		replace:    `${negated ? '!' : ''}${helper}.is({{subject}})`,
		declaredIn: { 'right.object': enumFile, ...propertyFile ? { [`${left}.property`]: propertyFile } : {} },
		message:    `${hint} (\`${helper}.is\`), it narrows the type as well.`
	};
};

/** `v.tag === VertexType.X`, with `{{type|last}}` spelling the name of the matching helper */
const vertexIs = (id: string, options?: { negated?: boolean, optional?: boolean }): ReplacementPattern =>
	discriminatorIs(id, {
		property: 'tag', enumName: 'VertexType', enumFile: VERTEX, propertyFile: VERTEX,
		helper:   '{{type|last}}Vertex', hint: 'Compare through the vertex helper'
	}, options);

/**
 * `n.type === RType.X`. Every `RType` member has a helper object of the same name prefixed with `R`
 * (`RType.Symbol` to `RSymbol`), so `{{type|last}}` names it without a table.
 * Only the enum is pinned to its file: `type` is declared once per node interface, and on the `RNode`
 * union it resolves to a synthesized symbol, so demanding a declaring file for it would match nothing.
 */
const nodeIs = (id: string, options?: { negated?: boolean, optional?: boolean }): ReplacementPattern =>
	discriminatorIs(id, {
		property: 'type', enumName: 'RType', enumFile: RTYPE,
		helper:   'R{{type|last}}', hint: 'Ask the AST node helper'
	}, options);

/**
 * `<Helper>.is(x) && <extra check on x>`, the body of a more specific guard written out.
 * `guard` pins down the right-hand side, `subject` is the path of the operand it repeats.
 */
const guardWrittenOut = (
	{ id, helper, member: narrower, file, guard, subject, message, fix }:
	{ id: string, helper: string, member: string, file: string, guard: string, subject: string, message: string, fix?: boolean }
): ReplacementPattern => ({
	id,
	selector:   `LogicalExpression[operator="&&"]${helperCall('left', helper, 'is')}${guard}`,
	capture:    { node: 'left.arguments.0' },
	replace:    `${helper}.${narrower}({{node}})`,
	declaredIn: { 'left.callee.object': file },
	sameText:   [['left.arguments.0', subject]],
	...fix === undefined ? {} : { fix },
	message
});

/**
 * `symbol.content === 'name'`. `content` of an {@link RSymbol} is an `Identifier`, which carries a namespace
 * and turns into an array once it has one, so `===` against a bare name silently misses `pkg::name`.
 */
const symbolName = (id: string, negated: boolean): ReplacementPattern => ({
	id,
	selector:   `BinaryExpression[operator="${negated ? '!==' : '==='}"][left.type="MemberExpression"]${member('left', 'content')}[right.type="Literal"][right.value=type(string)]`,
	capture:    { symbol: 'left.object', name: 'right' },
	replace:    `Identifier.getName({{symbol}}.content) ${negated ? '!==' : '==='} {{name}}`,
	declaredIn: { 'left.property': SYMBOL_NODE },
	/* which of the two is meant is the author's call, so this is offered rather than applied */
	fix:        false,
	message:    'An `Identifier` is not its name: `pkg::{{name}}` is an array and never `===` a string. Compare `Identifier.getName({{symbol}}.content)`, or `Identifier.matches` when the namespace should count.'
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
	{
		id: 'vertex-has-origin',
		selector: 'LogicalExpression[operator="&&"]'
			+ `${helperCall('left', 'FunctionCallVertex', 'is')}`
			+ `${call('right', 'includes')}[right.callee.object.type="MemberExpression"][right.callee.object.property.name="origin"]`,
		capture:    { vertex: 'left.arguments.0', origin: 'right.arguments.0' },
		replace:    'FunctionCallVertex.hasOrigin({{vertex}}, {{origin}})',
		declaredIn: { 'left.callee.object': VERTEX, 'right.callee.object.property': VERTEX },
		sameText:   [['left.arguments.0', 'right.callee.object.object']],
		/* `hasOrigin` is no type predicate, so the replacement can drop a narrowing the code below relies on */
		fix:        false,
		message:    'Use `FunctionCallVertex.hasOrigin`, it is exactly this check. Check the narrowing first, `hasOrigin` returns a plain boolean.'
	},
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
	vertexIs('vertex-is-not-optional', { negated: true, optional: true }),
	nodeIs('node-is'),
	nodeIs('node-is-not', { negated: true }),
	nodeIs('node-is-optional', { optional: true }),
	nodeIs('node-is-not-optional', { negated: true, optional: true }),
	guardWrittenOut({
		id:      'call-is-named', helper: 'RFunctionCall', member: 'isNamed', file: CALL_NODE,
		guard:   `[right.type="MemberExpression"]${member('right', 'named')}`,
		subject: 'right.object',
		message: 'Use `RFunctionCall.isNamed`, it is this check and narrows to `RNamedFunctionCall`.'
	}),
	guardWrittenOut({
		id:      'call-is-named-strict', helper: 'RFunctionCall', member: 'isNamed', file: CALL_NODE,
		guard:   `[right.type="BinaryExpression"][right.operator="==="][right.right.type="Literal"][right.right.value=true]${member('right.left', 'named')}`,
		subject: 'right.left.object',
		message: 'Use `RFunctionCall.isNamed`, it is this check and narrows to `RNamedFunctionCall`.'
	}),
	guardWrittenOut({
		id:      'call-is-unnamed', helper: 'RFunctionCall', member: 'isUnnamed', file: CALL_NODE,
		guard:   `[right.type="UnaryExpression"][right.operator="!"][right.argument.type="MemberExpression"]${member('right.argument', 'named')}`,
		subject: 'right.argument.object',
		message: 'Use `RFunctionCall.isUnnamed`, it is this check and narrows to `RUnnamedFunctionCall`.'
	}),
	guardWrittenOut({
		id:      'argument-is-named', helper: 'RArgument', member: 'isNamed', file: ARGUMENT_NODE,
		guard:   `${versusUndefined('right', true)}${member('right.left', 'name')}`,
		subject: 'right.left.object',
		message: 'Use `RArgument.isNamed`, it is this check and keeps the `name` non-optional afterwards.'
	}),
	guardWrittenOut({
		id:      'argument-is-with-value', helper: 'RArgument', member: 'isWithValue', file: ARGUMENT_NODE,
		guard:   `${versusUndefined('right', true)}${member('right.left', 'value')}`,
		subject: 'right.left.object',
		message: 'Use `RArgument.isWithValue`, it is this check and keeps the `value` non-optional afterwards.'
	}),
	guardWrittenOut({
		id:      'list-is-implicit', helper: 'RExpressionList', member: 'isImplicit', file: LIST_NODE,
		guard:   `${versusUndefined('right', false)}${member('right.left', 'grouping')}`,
		subject: 'right.left.object',
		message: 'Use `RExpressionList.isImplicit`, an expression list without `grouping` is exactly the implicit one.'
	}),
	symbolName('symbol-name-comparison', false),
	symbolName('symbol-name-comparison-not', true),
	{
		id:       'array-sum',
		selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="reduce"][arguments.length=2]'
			+ '[arguments.1.type="Literal"][arguments.1.value=0]'
			+ '[arguments.0.type="ArrowFunctionExpression"][arguments.0.params.length=2]'
			+ '[arguments.0.body.type="BinaryExpression"][arguments.0.body.operator="+"]',
		capture:  { array: 'callee.object' },
		replace:  'arraySum({{array}})',
		sameText: [['arguments.0.params.0', 'arguments.0.body.left'], ['arguments.0.params.1', 'arguments.0.body.right']],
		message:  'Use `arraySum`, summing a list is not a place to spell out a fold.'
	},
	{
		/* `filter` walks the whole list and allocates the matches only to ask whether there is one */
		id:       'some-instead-of-filter-length',
		selector: `${versusZero(true)}[left.type="MemberExpression"]${member('left', 'length')}`
			+ `${call('left.object', 'filter')}[left.object.arguments.length=1]`,
		capture:  { array: 'left.object.callee.object', predicate: 'left.object.arguments.0' },
		replace:  '{{array}}.some({{predicate}})',
		message:  '`filter(...).length > 0` walks the whole list and allocates the matches, `some` stops at the first hit.'
	},
	{
		id:       'none-instead-of-filter-length',
		selector: `${versusZero(false)}[left.type="MemberExpression"]${member('left', 'length')}`
			+ `${call('left.object', 'filter')}[left.object.arguments.length=1]`,
		capture:  { array: 'left.object.callee.object', predicate: 'left.object.arguments.0' },
		replace:  '!{{array}}.some({{predicate}})',
		message:  '`filter(...).length === 0` walks the whole list and allocates the matches, `!some` stops at the first hit.'
	}
];

export = patterns;
