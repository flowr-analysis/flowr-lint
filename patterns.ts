/**
 * Default patterns of `flowr/replacement-pattern`, see the README for the format.
 * The helpers they point at live in flowR, the paths below are the files declaring them.
 */

import type { ReplacementPattern } from './pattern-type';

const Files = {
	edge:        'dataflow/graph/edge',
	vertex:      'dataflow/graph/vertex',
	graph:       'dataflow/graph/graph',
	rType:       'r-bridge/lang-4.x/ast/model/type',
	call:        'r-bridge/lang-4.x/ast/model/nodes/r-function-call',
	argument:    'r-bridge/lang-4.x/ast/model/nodes/r-argument',
	symbol:      'r-bridge/lang-4.x/ast/model/nodes/r-symbol',
	string:      'r-bridge/lang-4.x/ast/model/nodes/r-string',
	list:        'r-bridge/lang-4.x/ast/model/nodes/r-expression-list',
	model:       'r-bridge/lang-4.x/ast/model/model',
	nodeId:      'r-bridge/lang-4.x/ast/model/processing/node-id',
	range:       'util/range',
	identifier:  'dataflow/environments/identifier',
	environment: 'dataflow/environments/environment',
	arrays:      'util/collections/arrays',
	strings:     'util/text/strings'
} as const;

/* selector parts, each about the node at the given path, `''` being the match itself */

const at = (path: string, key: string): string => path === '' ? key : `${path}.${key}`;
/** `x.<name>`, without asserting the node kind */
const member = (path: string, name: string): string => `[${at(path, 'computed')}=false][${at(path, 'property.name')}="${name}"]`;
/** `x.<name>` */
const prop = (path: string, name: string): string => `[${at(path, 'type')}="MemberExpression"]${member(path, name)}`;
/** a call of `x.<method>(...)` */
const call = (path: string, method: string): string => `[${at(path, 'type')}="CallExpression"]${prop(at(path, 'callee'), method)}`;
/** a call of `<Helper>.<method>(...)` with `n` arguments */
const helperCall = (path: string, helper: string, method: string, n = 1): string =>
	`${call(path, method)}[${at(path, 'callee.object.name')}="${helper}"][${at(path, 'arguments.length')}=${n}]`;
/** the identifier `<name>` */
const identifier = (path: string, name: string): string => `[${at(path, 'type')}="Identifier"][${at(path, 'name')}="${name}"]`;
/** the string literal `<value>`, or any string literal */
const text = (path: string, value?: string): string => `[${at(path, 'type')}="Literal"][${at(path, 'value')}=${value === undefined ? 'type(string)' : `"${value}"`}]`;
/** `!x` */
const not = (path: string): string => `[${at(path, 'type')}="UnaryExpression"][${at(path, 'operator')}="!"]`;
/** `x === undefined` or, `set`, `x !== undefined` */
const versusUndefined = (at: string, set: boolean): string =>
	`[${at}.type="BinaryExpression"][${at}.operator="${set ? '!==' : '==='}"]${identifier(`${at}.right`, 'undefined')}`;
/** `<Enum>.<Member>` */
const enumMember = (at: string, name: string): string => `[${at}.type="MemberExpression"][${at}.computed=false][${at}.object.name="${name}"]`;
/** `x.types` */
const types = (at: string): string => prop(at, 'types');
/** compared against `0`, for "some bit is set" or, `nonZero` false, for "none is" */
const versusZero = (nonZero: boolean): string => `BinaryExpression[operator=${nonZero ? '/^(!==|>)$/' : '"==="'}][right.type="Literal"][right.value=0]`;
/** the root as `===` or, `negated`, `!==` */
const equality = (negated: boolean): string => `BinaryExpression[operator="${negated ? '!==' : '==='}"]`;
const bang = (negated: boolean): string => negated ? '!' : '';

/** A pattern and its negated twin, under the two ids given. */
const negatable = (ids: readonly [string, string], make: (negated: boolean) => Omit<ReplacementPattern, 'id'>): ReplacementPattern[] =>
	[{ id: ids[0], ...make(false) }, { id: ids[1], ...make(true) }];

/** A pattern and its twin spelled with `?.`, which wraps the member expression in a chain. */
const optionalToo = (ids: readonly [string, string], make: (optional: boolean) => Omit<ReplacementPattern, 'id'>): ReplacementPattern[] =>
	[{ id: ids[0], ...make(false) }, { id: ids[1], ...make(true) }];

/** `x.types === T`, on the edge or on a destructured `types` */
const edgeIsOnly = (negated: boolean, destructured: boolean): Omit<ReplacementPattern, 'id'> => ({
	selector:   equality(negated) + (destructured ? `${identifier('left', 'types')}${enumMember('right', 'EdgeType')}` : `${types('left')}:not([right.type="Literal"])`),
	capture:    destructured ? { type: 'right' } : { edge: 'left.object', type: 'right' },
	replace:    `${bang(negated)}DfEdge.isOnlyType(${destructured ? '{ types }' : '{{edge}}'}, {{type}})`,
	declaredIn: destructured ? { 'right.object': Files.edge } : { 'left.property': Files.edge },
	message:    `\`${destructured ? '' : 'x.'}types ${negated ? '!==' : '==='} T\` `
		+ (negated ? 'holds as soon as any other type is set' : 'holds only if T is the *only* type')
		+ `; say so with \`${bang(negated)}DfEdge.isOnlyType\`, or use \`DfEdge.${negated ? 'doesNotIncludeType' : 'includesType'}\` for "${negated ? 'has not' : 'has'} this type".`
		+ (destructured ? ' Prefer keeping the edge over destructuring `types`, the helpers take it directly.' : '')
});

/** `(x.types & T) !== 0` and its inverse */
const edgeMask = (id: string, helper: string, nonZero: boolean): ReplacementPattern => ({
	id,
	selector:   `${versusZero(nonZero)}[left.type="BinaryExpression"][left.operator="&"]${types('left.left')}`,
	capture:    { edge: 'left.left.object', type: 'left.right' },
	replace:    `DfEdge.${helper}({{edge}}, {{type}})`,
	declaredIn: { 'left.left.property': Files.edge },
	message:    `Use \`DfEdge.${helper}\` instead of testing the bitmask by hand.`
});

/** `x.types !== 0`, the literal-0 comparisons {@link edgeIsOnly} leaves out */
const edgeStates = (id: string, helper: string, what: string, nonZero: boolean): ReplacementPattern => ({
	id,
	selector:   `${versusZero(nonZero)}${types('left')}`,
	capture:    { edge: 'left.object' },
	replace:    `DfEdge.${helper}({{edge}})`,
	declaredIn: { 'left.property': Files.edge },
	message:    `Use \`DfEdge.${helper}\` to ask whether the edge states ${what}.`
});

/**
 * `v.tag === VertexType.X` and `n.type === RType.X`, in all four spellings.
 * The helpers are named after the enum members, so `{{type|last}}` spells the check: `VertexType.Use` to `DfgVertex.isUse`,
 * `RType.Symbol` to `RSymbol.is`. The property is only pinned for vertices, on the `RNode` union `type` has no declaring file.
 */
const discriminatorIs = (
	ids: readonly [string, string, string, string],
	{ property, enumName, enumFile, propertyFile, helper, hint }:
	{ property: string, enumName: string, enumFile: string, propertyFile?: string, helper: string, hint: string }
): ReplacementPattern[] => [false, true].flatMap(optional => {
	const left = optional ? 'left.expression' : 'left';
	return negatable([ids[optional ? 2 : 0], ids[optional ? 3 : 1]], negated => ({
		selector:   `${equality(negated)}[left.type="${optional ? 'ChainExpression' : 'MemberExpression'}"]${member(left, property)}${enumMember('right', enumName)}`,
		capture:    { subject: `${left}.object`, type: 'right' },
		replace:    `${bang(negated)}${helper}({{subject}})`,
		declaredIn: { 'right.object': enumFile, ...propertyFile ? { [`${left}.property`]: propertyFile } : {} },
		message:    `${hint} (\`${helper}\`), it narrows the type as well.`
	}));
});

/** `<Helper>.is(x) && <extra check on x>`, a more specific guard written out; `subject` is where the check repeats `x` */
const guardWrittenOut = (id: string, helper: string, narrower: string, file: string, guard: string, subject: string, message: string): ReplacementPattern => ({
	id,
	selector:   `LogicalExpression[operator="&&"]${helperCall('left', helper, 'is')}${guard}`,
	capture:    { node: 'left.arguments.0' },
	replace:    `${helper}.${narrower}({{node}})`,
	declaredIn: { 'left.callee.object': file },
	sameText:   [['left.arguments.0', subject]],
	message
});

/** `Identifier.getName(<call>.functionName.content)` */
const calledName = (at: string): string => `${helperCall(at, 'Identifier', 'getName')}${prop(`${at}.arguments.0`, 'content')}${prop(`${at}.arguments.0.object`, 'functionName')}`;

/**
 * `RFunctionCall.isNamed(x) && Identifier.getName(x.functionName.content) === 'f'`, and the negation
 * `!RFunctionCall.isNamed(x) || ... !== 'f'`. `inSet` covers `Names.has(...)` in place of the comparison.
 */
const namedCallOf = (inSet: boolean) => (negated: boolean): Omit<ReplacementPattern, 'id'> => {
	const guard = negated ? 'left.argument' : 'left';
	const test = inSet ? (negated ? 'right.argument' : 'right') : 'right';
	const nameCall = inSet ? `${test}.arguments.0` : 'right.left';
	return {
		selector: `LogicalExpression[operator="${negated ? '||' : '&&'}"]${negated ? not('left') : ''}${helperCall(guard, 'RFunctionCall', 'isNamed')}`
			+ (inSet
				? `${negated ? not('right') : ''}${call(test, 'has')}[${test}.arguments.length=1]`
				: `[right.type="BinaryExpression"][right.operator="${negated ? '!==' : '==='}"]:matches(${text('right.right')}, [right.right.type="Identifier"])`)
			+ calledName(nameCall),
		capture:    { node: `${guard}.arguments.0`, names: inSet ? `${test}.callee.object` : 'right.right' },
		replace:    `${bang(negated)}RFunctionCall.isNamed({{node}}, {{names}})`,
		declaredIn: { [`${guard}.callee.object`]: Files.call },
		sameText:   [[`${guard}.arguments.0`, `${nameCall}.arguments.0.object.object`]],
		message:    `Use \`${bang(negated)}RFunctionCall.isNamed({{node}}, {{names}})\`, it checks the call and its name in one go and still narrows.`
	};
};

/** `g.outgoingEdges(id) ?? []` or `?? NoEdges`, which `edgesFrom`/`edgesTo` already are */
const edgesFallback = (id: string, raw: string, total: string): ReplacementPattern => ({
	id,
	selector: 'LogicalExpression[operator="??"]:matches([right.type="ArrayExpression"][right.elements.length=0], [right.type="Identifier"][right.name="NoEdges"])'
		+ `${call('left', raw)}[left.callee.computed=false][left.arguments.length=1]`,
	capture:    { graph: 'left.callee.object', id: 'left.arguments.0' },
	replace:    `{{graph}}.${total}({{id}})`,
	declaredIn: { 'left.callee.property': Files.graph },
	message:    `\`${total}\` is \`${raw}\` without the fallback: it answers with the shared empty map itself.`
});

/**
 * `x.info.fullLexeme ?? x.lexeme` and its mirrors, reading the text or the range of a node by hand.
 * `infoFirst` says which side of the `??` goes through `info`.
 */
const nodeFallback = (ids: readonly [string, string], infoProp: string, plainProp: string, infoFirst: boolean, helper: string, message: string): ReplacementPattern[] =>
	optionalToo(ids, optional => {
		const [infoSide, plainSide] = infoFirst ? ['left', 'right'] : ['right', 'left'];
		const info = optional ? `${infoSide}.expression` : infoSide, plain = optional ? `${plainSide}.expression` : plainSide;
		const kind = optional ? 'ChainExpression' : 'MemberExpression';
		return {
			selector:   `LogicalExpression[operator="??"][${infoSide}.type="${kind}"][${plainSide}.type="${kind}"]${member(info, infoProp)}${prop(`${info}.object`, 'info')}${member(plain, plainProp)}`,
			capture:    { node: `${plain}.object` },
			replace:    `${helper}({{node}})`,
			declaredIn: { [`${info}.property`]: Files.model, [`${plain}.property`]: Files.model },
			sameText:   [[`${info}.object.object`, `${plain}.object`]],
			message
		};
	});

/** `range?.[0]` and friends, the accessors say which index is which */
const rangeIndex = (id: string, index: number, reader: string): ReplacementPattern => ({
	id,
	selector: 'ChainExpression[expression.type="MemberExpression"][expression.computed=true][expression.optional=true]'
		+ `[expression.property.type="Literal"][expression.property.value=${index}][expression.object.type="MemberExpression"]`
		+ ':matches([expression.object.property.name="location"], [expression.object.property.name="fullRange"])',
	capture:    { range: 'expression.object' },
	replace:    `SourceRange.${reader}({{range}})`,
	declaredIn: { 'expression.object.property': Files.model },
	message:    `\`range?.[${index}]\` hides what the index means; \`SourceRange.${reader}\` says it and answers \`undefined\` for an absent range just the same.`
});

/** `arg === EmptyArgument ? undefined : arg.value`, and the inverted spelling */
const unpacked = (id: string, empty: boolean): ReplacementPattern => {
	const [value, absent] = empty ? ['alternate', 'consequent'] : ['consequent', 'alternate'];
	return {
		id,
		selector: `ConditionalExpression[test.type="BinaryExpression"][test.operator="${empty ? '===' : '!=='}"]${identifier('test.right', 'EmptyArgument')}`
			+ `${identifier(absent, 'undefined')}${prop(value, 'value')}`,
		capture:    { arg: 'test.left' },
		replace:    'RArgument.valueOf({{arg}})',
		declaredIn: { 'test.right': Files.call, [`${value}.property`]: Files.argument },
		sameText:   [['test.left', `${value}.object`]],
		message:    '`RArgument.valueOf` is this: the value of an argument, `undefined` for an empty one.'
	};
};

/**
 * `args.find(a => <a is not empty> && a.name?.content === 'x')`.
 * `guard` is how the emptiness is tested: `a !== EmptyArgument`, `!RArgument.isEmpty(a)` or `RArgument.isNotEmpty(a)`.
 */
const findNamed = (id: string, guard: 'neq' | 'isEmpty' | 'isNotEmpty'): ReplacementPattern => {
	const body = 'arguments.0.body', test = `${body}.left`, rhs = `${body}.right`, content = `${rhs}.left.expression`;
	const [reference, pin, shape] = {
		neq:        [`${test}.left`, `${test}.right`, `[${test}.type="BinaryExpression"][${test}.operator="!=="]${identifier(`${test}.right`, 'EmptyArgument')}`],
		isEmpty:    [`${test}.argument.arguments.0`, `${test}.argument.callee.object`, `${not(test)}${helperCall(`${test}.argument`, 'RArgument', 'isEmpty')}`],
		isNotEmpty: [`${test}.arguments.0`, `${test}.callee.object`, helperCall(test, 'RArgument', 'isNotEmpty')]
	}[guard];
	return {
		id,
		selector: `CallExpression${prop('callee', 'find')}[arguments.length=1]`
			+ `[arguments.0.type="ArrowFunctionExpression"][arguments.0.params.length=1][${body}.type="LogicalExpression"][${body}.operator="&&"]`
			+ `${shape}[${rhs}.type="BinaryExpression"][${rhs}.operator="==="][${rhs}.left.type="ChainExpression"]`
			+ `${member(content, 'content')}${prop(`${content}.object`, 'name')}:matches([${rhs}.right.type="Literal"], [${rhs}.right.type="Identifier"])`,
		capture:    { args: 'callee.object', name: `${rhs}.right` },
		replace:    'RArgument.findNamed({{args}}, {{name}})',
		declaredIn: { [pin]: guard === 'neq' ? Files.call : Files.argument, [`${content}.property`]: Files.symbol },
		sameText:   [['arguments.0.params.0', reference], ['arguments.0.params.0', `${content}.object.object`]],
		message:    '`RArgument.findNamed` finds the argument given by this exact name and skips the empty ones itself.'
	};
};

/** `[...new Set(<x>)]` */
const spreadSet = (extra: string): string => 'ArrayExpression[elements.length=1][elements.0.type="SpreadElement"][elements.0.argument.type="NewExpression"]'
	+ `[elements.0.argument.callee.name="Set"][elements.0.argument.arguments.length=1]${extra}`;

/** `[...g.edgesFrom(id)].filter(([, e]) => DfEdge.includesType(e, T)).map(([t]) => t)` and its `edgesTo` twin */
const edgeNeighbors = (id: string, raw: string, helper: string): ReplacementPattern => {
	const filter = 'callee.object', spread = `${filter}.callee.object.elements.0`, test = `${filter}.arguments.0`;
	return {
		id,
		selector: `CallExpression${call('', 'map')}[arguments.length=1]`
			+ '[arguments.0.type="ArrowFunctionExpression"][arguments.0.params.length=1][arguments.0.params.0.type="ArrayPattern"]'
			+ '[arguments.0.params.0.elements.length=1][arguments.0.body.type="Identifier"]'
			+ `${call(filter, 'filter')}[${filter}.arguments.length=1][${filter}.callee.object.type="ArrayExpression"]`
			+ `[${filter}.callee.object.elements.length=1][${spread}.type="SpreadElement"]${call(`${spread}.argument`, raw)}[${spread}.argument.arguments.length=1]`
			+ `[${test}.type="ArrowFunctionExpression"][${test}.params.0.type="ArrayPattern"][${test}.params.0.elements.length=2]`
			+ `[${test}.params.0.elements.1.type="Identifier"]${helperCall(`${test}.body`, 'DfEdge', 'includesType', 2)}`,
		capture:    { graph: `${spread}.argument.callee.object`, node: `${spread}.argument.arguments.0`, types: `${test}.body.arguments.1` },
		replace:    `${helper}({{graph}}, {{node}}, {{types}})`,
		declaredIn: { [`${spread}.argument.callee.property`]: Files.graph, [`${test}.body.callee.property`]: Files.edge },
		sameText:   [['arguments.0.params.0.elements.0', 'arguments.0.body'], [`${test}.params.0.elements.1`, `${test}.body.arguments.0`]],
		message:    `\`${helper}\` is this walk, name it instead of spelling out the filter.`
	};
};

/** `x.name === 'lit'` on a vertex */
const vertexName = (negated: boolean): Omit<ReplacementPattern, 'id'> => ({
	selector:   `${equality(negated)}${prop('left', 'name')}${text('right')}`,
	capture:    { vertex: 'left.object', name: 'right' },
	replace:    `Identifier.getName({{vertex}}.name) ${negated ? '!==' : '==='} {{name}}`,
	declaredIn: { 'left.property': Files.vertex },
	/* what the call is, rather than how it is spelled, may be what is meant */
	fix:        false,
	message:    'The name of a call is how it is spelled: `pkg::name` is an array here, and an alias or a shadowing definition is not seen at all. Ask what it is with `DfgVertex.hasOrigin`, or `Dataflow.qualify` for the package.'
});

/** `symbol.content === 'name'`, which misses `pkg::name` as an identifier with a namespace is an array */
const symbolName = (negated: boolean): Omit<ReplacementPattern, 'id'> => ({
	selector:   `${equality(negated)}${prop('left', 'content')}${text('right')}`,
	capture:    { symbol: 'left.object', name: 'right' },
	replace:    `Identifier.getName({{symbol}}.content) ${negated ? '!==' : '==='} {{name}}`,
	declaredIn: { 'left.property': Files.symbol },
	/* whether the namespace should count is the author's call */
	fix:        false,
	message:    'An `Identifier` is not its name: `pkg::{{name}}` is an array and never `===` a string. Compare `Identifier.getName({{symbol}}.content)`, or `Identifier.matches` when the namespace should count.'
});

/** `c.functionName.lexeme === 'lit'` on a call */
const calleeLexeme = (negated: boolean): Omit<ReplacementPattern, 'id'> => ({
	selector:   `${equality(negated)}${prop('left', 'lexeme')}${prop('left.object', 'functionName')}${text('right')}`,
	capture:    { call: 'left.object.object', name: 'right' },
	replace:    `${bang(negated)}RFunctionCall.isNamed({{call}}, {{name}})`,
	declaredIn: { 'left.property': Files.model },
	/* the lexeme keeps quotes and the namespace, the helper compares the name */
	fix:        false,
	message:    'The lexeme is how the callee is spelled, `RFunctionCall.isNamed` compares its name and keeps `pkg::{{name}}` and backticks out of the way.'
});

/** `isNamed(n) ? n.functionName.content : undefined`, guarded by the call or by a read of `named` */
const calledNameOf = (id: string, guard: 'call' | 'property'): ReplacementPattern => ({
	id,
	selector: `ConditionalExpression${identifier('alternate', 'undefined')}${prop('consequent', 'content')}${prop('consequent.object', 'functionName')}`
		+ (guard === 'call' ? helperCall('test', 'RFunctionCall', 'isNamed') : prop('test', 'named')),
	capture:    { node: 'consequent.object.object' },
	replace:    'RFunctionCall.calledName({{node}})',
	declaredIn: { 'consequent.object.property': Files.call, [guard === 'call' ? 'test.callee.object' : 'test.property']: Files.call },
	sameText:   [[guard === 'call' ? 'test.arguments.0' : 'test.object', 'consequent.object.object']],
	message:    '`RFunctionCall.calledName` is this: the name of a named call, `undefined` otherwise.'
});

/** `v.origin.includes(o)` behind a call guard, as `isFunctionCall(v) && ...` or `!isFunctionCall(v) || !...` */
const originGuarded = (negated: boolean): Omit<ReplacementPattern, 'id'> => {
	const guard = negated ? 'left.argument' : 'left', includes = negated ? 'right.argument' : 'right';
	return {
		selector: `LogicalExpression[operator="${negated ? '||' : '&&'}"]${negated ? `${not('left')}${not('right')}` : ''}${helperCall(guard, 'DfgVertex', 'isFunctionCall')}`
			+ `${call(includes, 'includes')}[${includes}.arguments.length=1]${prop(`${includes}.callee.object`, 'origin')}`,
		capture:    { vertex: `${guard}.arguments.0`, origin: `${includes}.arguments.0` },
		replace:    `${bang(negated)}DfgVertex.hasOrigin({{vertex}}, {{origin}})`,
		declaredIn: { [`${guard}.callee.object`]: Files.vertex, [`${includes}.callee.object.property`]: Files.vertex },
		sameText:   [[`${guard}.arguments.0`, `${includes}.callee.object.object`]],
		/* `hasOrigin` does not narrow, code below may rely on the guard */
		fix:        false,
		message:    `Use \`${bang(negated)}DfgVertex.hasOrigin\`, it is exactly this check. Check the narrowing first, \`hasOrigin\` returns a plain boolean.`
	};
};

/** `String(id).startsWith('built-in:')` and the plain `id.startsWith('built-in:')` */
const builtInPrefix = (id: string, wrapped: boolean): ReplacementPattern => ({
	id,
	selector: `CallExpression${prop('callee', 'startsWith')}[arguments.length=1]${text('arguments.0', 'built-in:')}`
		+ (wrapped ? '[callee.object.type="CallExpression"][callee.object.callee.name="String"][callee.object.arguments.length=1]' : ':not([callee.object.type="CallExpression"])'),
	capture:  { id: wrapped ? 'callee.object.arguments.0' : 'callee.object' },
	replace:  'NodeId.isBuiltIn({{id}})',
	helperIn: Files.nodeId,
	/* a lexeme or a path is not a node id */
	...wrapped ? {} : { fix: false },
	message:  'Ask `NodeId.isBuiltIn`, the `built-in:` prefix is the helper\'s business.'
});

const builtInId = (id: string, selector: string, name: string): ReplacementPattern => ({
	id,
	selector,
	capture:  { name },
	replace:  'NodeId.toBuiltIn({{name}})',
	helperIn: Files.nodeId,
	message:  'Build a built-in id with `NodeId.toBuiltIn`, the prefix is the helper\'s business.'
});

/** `filter(...).length > 0` or `=== 0`, `some` stops at the first hit */
const someInsteadOfFilter = (id: string, nonZero: boolean): ReplacementPattern => ({
	id,
	selector: `${versusZero(nonZero)}${prop('left', 'length')}${call('left.object', 'filter')}[left.object.arguments.length=1]`,
	capture:  { array: 'left.object.callee.object', predicate: 'left.object.arguments.0' },
	replace:  `${bang(!nonZero)}{{array}}.some({{predicate}})`,
	message:  `\`filter(...).length ${nonZero ? '> 0' : '=== 0'}\` walks the whole list and allocates the matches, \`${bang(!nonZero)}some\` stops at the first hit.`
});

const patterns: readonly ReplacementPattern[] = [
	...negatable(['edge-is-only-type', 'edge-is-not-only-type'], negated => edgeIsOnly(negated, false)),
	...negatable(['edge-is-only-type-destructured', 'edge-is-not-only-type-destructured'], negated => edgeIsOnly(negated, true)),
	edgeStates('edge-has-any-type', 'hasAnyType', 'anything', true),
	edgeStates('edge-has-no-type', 'hasNoType', 'nothing', false),
	edgeMask('edge-includes-type', 'includesType', true),
	edgeMask('edge-does-not-include-type', 'doesNotIncludeType', false),
	{
		/* the `?? []` only exists so a positional destructure survives an absent location */
		id:         'location-at-node',
		selector:   `LogicalExpression[operator="??"][right.type="ArrayExpression"][right.elements.length=0]${helperCall('left', 'SourceLocation', 'fromNode')}`,
		capture:    { node: 'left.arguments.0' },
		replace:    'SourceLocation.at({{node}})',
		declaredIn: { 'left.callee.object': Files.range },
		/* the destructure has to become property reads */
		fix:        false,
		message:    '`SourceLocation.at({{node}})` answers with a view: `.startLine`, `.file`, and `?.` for the absent case, so the `?? []` and the positional destructure both go away.'
	},
	{
		/* a source range is a source location without a file, so the readers take a location as it is */
		id:       'location-range-hop',
		selector: 'CallExpression[callee.type="MemberExpression"][callee.computed=false][callee.object.name=/^Source(Range|Location)$/][arguments.length=1]'
			+ helperCall('arguments.0', 'SourceLocation', 'getRange'),
		capture:    { reader: 'callee.property', location: 'arguments.0.arguments.0' },
		replace:    'SourceLocation.{{reader}}({{location}})',
		declaredIn: { 'callee.object': Files.range, 'arguments.0.callee.object': Files.range },
		message:    'Drop the `getRange` hop, `SourceLocation.{{reader}}` reads the location directly.'
	},
	{
		/* the readers answer `undefined` for an absent input */
		id:       'accessor-undefined-guard',
		selector: `ConditionalExpression${versusUndefined('test', false)}${identifier('consequent', 'undefined')}`
			+ '[alternate.type="CallExpression"][alternate.callee.type="MemberExpression"][alternate.callee.computed=false]'
			+ '[alternate.callee.property.name=/^(get|format|view|at)/][alternate.callee.object.name=/^Source(Range|Location)$/][alternate.arguments.length=1]',
		capture:    { call: 'alternate' },
		replace:    '{{call}}',
		sameText:   [['test.left', 'alternate.arguments.0']],
		declaredIn: { 'alternate.callee.object': Files.range },
		message:    'The reader passes an absent input through, the `=== undefined` guard says nothing on top of it.'
	},
	{
		id:         'identifier-tostring-fallback',
		selector:   `CallExpression${helperCall('', 'Identifier', 'toString')}[arguments.0.type="LogicalExpression"][arguments.0.operator="??"]${text('arguments.0.right', '')}`,
		capture:    { id: 'arguments.0.left' },
		replace:    'Identifier.toString({{id}})',
		declaredIn: { 'callee.object': Files.identifier },
		/* an empty string and `undefined` read differently downstream */
		fix:        false,
		message:    '`Identifier.toString` passes an absent identifier through; the `?? \'\'` turns "no name" into the name `""`.'
	},
	{
		id:         'edge-includes-type-truthy',
		selector:   `:matches(IfStatement, ConditionalExpression, WhileStatement, DoWhileStatement, LogicalExpression, UnaryExpression[operator="!"], ArrowFunctionExpression) > BinaryExpression[operator="&"]${types('left')}`,
		capture:    { edge: 'left.object', type: 'right' },
		replace:    'DfEdge.includesType({{edge}}, {{type}})',
		declaredIn: { 'left.property': Files.edge },
		message:    'Do not rely on the bitmask being truthy, `DfEdge.includesType` says what is meant.'
	},
	...negatable(['vertex-has-origin', 'vertex-lacks-origin'], originGuarded),
	edgesFallback('graph-edges-from', 'outgoingEdges', 'edgesFrom'),
	edgesFallback('graph-edges-to', 'ingoingEdges', 'edgesTo'),
	...discriminatorIs(['vertex-is', 'vertex-is-not', 'vertex-is-optional', 'vertex-is-not-optional'], {
		property:     'tag', enumName:     'VertexType', enumFile:     Files.vertex, propertyFile: Files.vertex,
		helper:       'DfgVertex.is{{type|last}}', hint:         'Compare through the vertex helper'
	}),
	...discriminatorIs(['node-is', 'node-is-not', 'node-is-optional', 'node-is-not-optional'], {
		property: 'type', enumName: 'RType', enumFile: Files.rType,
		helper:   'R{{type|last}}.is', hint:     'Ask the AST node helper'
	}),
	guardWrittenOut('call-is-named', 'RFunctionCall', 'isNamed', Files.call, prop('right', 'named'), 'right.object',
		'Use `RFunctionCall.isNamed`, it is this check and narrows to `RNamedFunctionCall`.'),
	guardWrittenOut('call-is-named-strict', 'RFunctionCall', 'isNamed', Files.call,
		`[right.type="BinaryExpression"][right.operator="==="][right.right.type="Literal"][right.right.value=true]${member('right.left', 'named')}`, 'right.left.object',
		'Use `RFunctionCall.isNamed`, it is this check and narrows to `RNamedFunctionCall`.'),
	guardWrittenOut('call-is-unnamed', 'RFunctionCall', 'isUnnamed', Files.call, `${not('right')}${prop('right.argument', 'named')}`, 'right.argument.object',
		'Use `RFunctionCall.isUnnamed`, it is this check and narrows to `RUnnamedFunctionCall`.'),
	guardWrittenOut('argument-is-named', 'RArgument', 'isNamed', Files.argument, `${versusUndefined('right', true)}${member('right.left', 'name')}`, 'right.left.object',
		'Use `RArgument.isNamed`, it is this check and keeps the `name` non-optional afterwards.'),
	guardWrittenOut('argument-is-with-value', 'RArgument', 'isWithValue', Files.argument, `${versusUndefined('right', true)}${member('right.left', 'value')}`, 'right.left.object',
		'Use `RArgument.isWithValue`, it is this check and keeps the `value` non-optional afterwards.'),
	guardWrittenOut('list-is-implicit', 'RExpressionList', 'isImplicit', Files.list, `${versusUndefined('right', false)}${member('right.left', 'grouping')}`, 'right.left.object',
		'Use `RExpressionList.isImplicit`, an expression list without `grouping` is exactly the implicit one.'),
	...negatable(['call-is-named-literal', 'call-is-not-named-literal'], namedCallOf(false)),
	...negatable(['call-is-named-in-set', 'call-is-not-named-in-set'], namedCallOf(true)),
	...nodeFallback(['node-lexeme', 'node-lexeme-optional'], 'fullLexeme', 'lexeme', true, 'RNode.lexeme',
		'Use `RNode.lexeme`, it reads the code the node spans, the full lexeme first.'),
	...nodeFallback(['node-own-lexeme', 'node-own-lexeme-optional'], 'fullLexeme', 'lexeme', false, 'RNode.ownLexeme',
		'Use `RNode.ownLexeme`, it reads the token the node is made of, its own lexeme first.'),
	...nodeFallback(['node-range', 'node-range-optional'], 'fullRange', 'location', true, 'SourceRange.fromNode',
		'Use `SourceRange.fromNode`, it reads the full range and falls back to the location.'),
	...nodeFallback(['node-own-range', 'node-own-range-optional'], 'fullRange', 'location', false, 'SourceRange.ownFromNode',
		'Use `SourceRange.ownFromNode`, it reads the location of the node\'s own token and falls back to the full range.'),
	rangeIndex('range-start-line', 0, 'getStartLine'),
	rangeIndex('range-start-column', 1, 'getStartColumn'),
	rangeIndex('range-end-line', 2, 'getEndLine'),
	rangeIndex('range-end-column', 3, 'getEndColumn'),
	{
		id:       'node-id-recover-name',
		selector: `ChainExpression[expression.type="MemberExpression"][expression.optional=true]${member('expression', 'lexeme')}`
			+ `${call('expression.object', 'get')}[expression.object.callee.computed=false][expression.object.arguments.length=1]`
			+ ':matches([expression.object.callee.object.name=/idMap/i], [expression.object.callee.object.property.name=/idMap/i])',
		capture:    { id: 'expression.object.arguments.0', map: 'expression.object.callee.object' },
		replace:    'NodeId.recoverName({{id}}, {{map}})',
		declaredIn: { 'expression.property': Files.model },
		message:    '`NodeId.recoverName` is this lookup, the lexeme of the node an id belongs to.'
	},
	unpacked('unpack-arg', true),
	unpacked('unpack-arg-inverted', false),
	findNamed('find-named-arg', 'neq'),
	findNamed('find-named-arg-not-empty', 'isNotEmpty'),
	findNamed('find-named-arg-negated-empty', 'isEmpty'),
	{
		id:       'call-sole-argument',
		selector: 'ConditionalExpression[test.type="LogicalExpression"][test.operator="&&"][test.left.type="BinaryExpression"][test.left.operator="==="]'
			+ `${prop('test.left.left', 'length')}[test.left.right.type="Literal"][test.left.right.value=1]`
			+ '[test.right.type="BinaryExpression"][test.right.operator="!=="][test.right.left.type="MemberExpression"][test.right.left.computed=true]'
			+ `[test.right.left.property.value=0]${identifier('test.right.right', 'EmptyArgument')}`
			+ `[consequent.type="MemberExpression"][consequent.computed=true][consequent.property.value=0]${identifier('alternate', 'undefined')}`,
		capture:    { args: 'test.left.left.object' },
		replace:    'RFunctionCall.soleArgument({{args}})',
		declaredIn: { 'test.right.right': Files.call },
		sameText:   [['test.left.left.object', 'test.right.left.object'], ['test.left.left.object', 'consequent.object']],
		message:    '`RFunctionCall.soleArgument` is this: the one argument, `undefined` unless there is exactly one and it is not empty.'
	},
	calledNameOf('call-called-name', 'call'),
	calledNameOf('call-called-name-named', 'property'),
	...negatable(['callee-lexeme-comparison', 'callee-lexeme-comparison-not'], calleeLexeme),
	...negatable(['vertex-name-comparison', 'vertex-name-comparison-not'], vertexName),
	...negatable(['symbol-name-comparison', 'symbol-name-comparison-not'], symbolName),
	{
		id:       'vertex-has-origin-array',
		selector: `LogicalExpression[operator="&&"][left.type="LogicalExpression"][left.operator="&&"]${helperCall('left.left', 'DfgVertex', 'isFunctionCall')}`
			+ `${helperCall('left.right', 'Array', 'isArray')}${prop('left.right.arguments.0', 'origin')}`
			+ `${call('right', 'includes')}[right.arguments.length=1]${prop('right.callee.object', 'origin')}`,
		capture:    { vertex: 'left.left.arguments.0', origin: 'right.arguments.0' },
		replace:    'DfgVertex.hasOrigin({{vertex}}, {{origin}})',
		declaredIn: { 'left.left.callee.object': Files.vertex, 'right.callee.object.property': Files.vertex },
		sameText:   [['left.left.arguments.0', 'left.right.arguments.0.object'], ['left.left.arguments.0', 'right.callee.object.object']],
		fix:        false,
		message:    '`DfgVertex.hasOrigin` is this check including the `Array.isArray`. Check the narrowing first, `hasOrigin` returns a plain boolean.'
	},
	{
		id:       'vertex-origin-includes',
		/* the guarded spellings have patterns of their own, and the origin of a `link` is no vertex origin */
		selector: `CallExpression${prop('callee', 'includes')}`
			+ ':not(LogicalExpression[operator="&&"] > CallExpression):not(LogicalExpression[operator="||"] > UnaryExpression > CallExpression)'
			+ `[arguments.length=1]${prop('callee.object', 'origin')}:not([callee.object.object.property.name="link"])`,
		capture:    { vertex: 'callee.object.object', origin: 'arguments.0' },
		replace:    'DfgVertex.hasOrigin({{vertex}}, {{origin}})',
		declaredIn: { 'callee.object.property': Files.vertex },
		/* the vertex may need the narrowing `hasOrigin` adds */
		fix:        false,
		message:    'Ask `DfgVertex.hasOrigin` instead of reading the origin list by hand.'
	},
	{
		id:       'graph-vertices-of-type',
		selector: `CallExpression${prop('callee', 'filter')}[arguments.length=1]${call('callee.object', 'vertices')}[callee.object.arguments.length=1]`
			+ '[arguments.0.type="ArrowFunctionExpression"][arguments.0.params.length=1][arguments.0.params.0.type="ArrayPattern"][arguments.0.params.0.elements.length=2]'
			+ '[arguments.0.params.0.elements.1.type="Identifier"][arguments.0.body.type="BinaryExpression"][arguments.0.body.operator="==="]'
			+ `${prop('arguments.0.body.left', 'tag')}${enumMember('arguments.0.body.right', 'VertexType')}`,
		capture:    { graph: 'callee.object.callee.object', type: 'arguments.0.body.right' },
		replace:    '{{graph}}.verticesOfType({{type}})',
		declaredIn: { 'callee.object.callee.property': Files.graph, 'arguments.0.body.right.object': Files.vertex },
		sameText:   [['arguments.0.params.0.elements.1', 'arguments.0.body.left.object']],
		/* the order follows the types, not the insertion */
		fix:        false,
		message:    '`verticesOfType` goes straight to the vertices of that type instead of walking all of them.'
	},
	edgeNeighbors('edge-targets', 'edgesFrom', 'Dataflow.targetsOf'),
	edgeNeighbors('edge-sources', 'edgesTo', 'Dataflow.sourcesOf'),
	{
		id:       'edge-has-type-between',
		selector: `CallExpression${helperCall('', 'DfEdge', 'includesType', 2)}`
			+ `[arguments.0.type="LogicalExpression"][arguments.0.operator="??"]${call('arguments.0.left', 'get')}[arguments.0.left.arguments.length=1]`
			+ `${call('arguments.0.left.callee.object', 'edgesFrom')}[arguments.0.left.callee.object.arguments.length=1]`
			+ '[arguments.0.right.type="ObjectExpression"][arguments.0.right.properties.length=1][arguments.0.right.properties.0.key.name="types"][arguments.0.right.properties.0.value.value=0]',
		capture:    { graph: 'arguments.0.left.callee.object.callee.object', from: 'arguments.0.left.callee.object.arguments.0', to: 'arguments.0.left.arguments.0', types: 'arguments.1' },
		replace:    'Dataflow.hasEdge({{graph}}, {{from}}, {{to}}, {{types}})',
		declaredIn: { 'callee.property': Files.edge, 'arguments.0.left.callee.object.callee.property': Files.graph },
		message:    '`Dataflow.hasEdge` asks whether an edge between two vertices carries a type, absent edge included.'
	},
	{
		id:       'environment-frames',
		selector: `ForStatement[init.type="VariableDeclaration"][init.declarations.length=1]${not('test')}${prop('test.argument', 'builtInEnv')}`
			+ `[update.type="AssignmentExpression"][update.operator="="]${prop('update.right', 'parent')}`,
		capture:    { frame: 'init.declarations.0.id', start: 'init.declarations.0.init', body: 'body' },
		replace:    'for(const {{frame}} of REnvironment.frames({{start}})) {{body}}',
		declaredIn: { 'test.argument.property': Files.environment },
		sameText:   [['init.declarations.0.id', 'test.argument.object'], ['init.declarations.0.id', 'update.left'], ['init.declarations.0.id', 'update.right.object']],
		/* the walk may stop early or reassign the variable */
		fix:        false,
		message:    '`REnvironment.frames` yields these frames, innermost first and without the built-in one.'
	},
	builtInPrefix('built-in-id-string', true),
	builtInPrefix('built-in-id-prefix', false),
	builtInId('to-built-in-template', 'TemplateLiteral[quasis.length=2][expressions.length=1][quasis.0.value.raw="built-in:"][quasis.1.value.raw=""]', 'expressions.0'),
	builtInId('to-built-in-concat', `BinaryExpression[operator="+"]${text('left', 'built-in:')}`, 'right'),
	{
		id:       'remove-r-quotes',
		selector: `CallExpression${prop('callee', 'replace')}[arguments.length=2][arguments.0.type="Literal"][arguments.0.regex.flags="g"]`
			+ String.raw`[arguments.0.regex.pattern=/^\^\[[^\]]*[\x22\x27\x60][^\]]*\]\|\[[^\]]*[\x22\x27\x60][^\]]*\]\$$/]`
			+ text('arguments.1', ''),
		capture:  { str: 'callee.object' },
		replace:  'RString.unquote({{str}})',
		helperIn: Files.string,
		/* the regex strips each end on its own, the helper only a matching pair */
		fix:      false,
		message:  '`RString.unquote` strips the R quotes of a name, `RString.splitQuotes` also tells which one it was.'
	},
	{
		id:       'escape-regex',
		selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name=/^replace(All)?$/][arguments.length=2][arguments.0.type="Literal"]'
			+ String.raw`[arguments.0.regex.flags="g"][arguments.0.regex.pattern=/^\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]$/]`
			+ String.raw`[arguments.1.type="Literal"][arguments.1.value=/^\\\$&$/]`,
		capture:  { str: 'callee.object' },
		replace:  'escapeRegex({{str}})',
		helperIn: Files.strings,
		message:  'Use `escapeRegex` to match text literally, do not spell out the character class.'
	},
	{
		id:       'identifier-split',
		selector: `CallExpression${prop('callee', 'split')}[arguments.length=1]${text('arguments.0', '::')}`
			+ ':matches([callee.object.name=/name|ident|symbol|qualified|fn/i], [callee.object.property.name=/name|ident|symbol|qualified|fn/i], [callee.object.expression.property.name=/name|ident|symbol|qualified|fn/i])',
		capture:  { str: 'callee.object' },
		replace:  'Identifier.parse({{str}})',
		helperIn: Files.identifier,
		/* the parts come back as a tuple, and the text may not be an identifier at all */
		fix:      false,
		message:  'Do not take `pkg::name` apart by hand: `Identifier.parse`, then `Identifier.getName` and `Identifier.getNamespace` (`:::` is part of the syntax).'
	},
	{
		id:       'unique-array',
		selector: spreadSet(':not([elements.0.argument.arguments.0.type="ArrayExpression"])'),
		capture:  { items: 'elements.0.argument.arguments.0' },
		replace:  'uniqueArray({{items}})',
		helperIn: Files.arrays,
		message:  'Use `uniqueArray`, a duplicate-free copy is not a place for a `Set` detour.'
	},
	{
		id:       'unique-array-merge',
		selector: spreadSet('[elements.0.argument.arguments.0.type="ArrayExpression"][elements.0.argument.arguments.0.elements.length=2]'
			+ '[elements.0.argument.arguments.0.elements.0.type="SpreadElement"][elements.0.argument.arguments.0.elements.1.type="SpreadElement"]'),
		capture:  { left: 'elements.0.argument.arguments.0.elements.0.argument', right: 'elements.0.argument.arguments.0.elements.1.argument' },
		replace:  'uniqueArrayMerge({{left}}, {{right}})',
		helperIn: Files.arrays,
		/* the helper wants arrays, a spread also takes iterables */
		fix:      false,
		message:  'Use `uniqueArrayMerge`, it merges two arrays without duplicates.'
	},
	{
		id:       'array-equal',
		selector: `LogicalExpression[operator="&&"][left.type="BinaryExpression"][left.operator="==="]${prop('left.left', 'length')}${prop('left.right', 'length')}`
			+ `${call('right', 'every')}[right.arguments.length=1][right.arguments.0.type="ArrowFunctionExpression"][right.arguments.0.params.length=2]`
			+ '[right.arguments.0.body.type="BinaryExpression"][right.arguments.0.body.operator="==="][right.arguments.0.body.right.type="MemberExpression"][right.arguments.0.body.right.computed=true]',
		capture:  { left: 'left.left.object', right: 'left.right.object' },
		replace:  'arrayEqual({{left}}, {{right}})',
		helperIn: Files.arrays,
		sameText: [['left.left.object', 'right.callee.object'], ['left.right.object', 'right.arguments.0.body.right.object'],
			['right.arguments.0.params.0', 'right.arguments.0.body.left'], ['right.arguments.0.params.1', 'right.arguments.0.body.right.property']],
		message: 'Use `arrayEqual`, comparing two arrays element by element is its job.'
	},
	{
		id:       'sort-code-unit',
		selector: `CallExpression${prop('callee', 'sort')}[arguments.length=1][arguments.0.type="ArrowFunctionExpression"]`
			+ `[arguments.0.params.length=2]${call('arguments.0.body', 'localeCompare')}[arguments.0.body.arguments.length=1]`,
		capture:  { list: 'callee.object' },
		replace:  '{{list}}.sort(compareByCodeUnit)',
		helperIn: Files.strings,
		sameText: [['arguments.0.params.0', 'arguments.0.body.callee.object'], ['arguments.0.params.1', 'arguments.0.body.arguments.0']],
		/* `localeCompare` is fine for an order only a reader sees */
		fix:      false,
		message:  '`localeCompare` depends on the locale and the ICU build, so an order that feeds an analysis result should use `compareByCodeUnit`.'
	},
	{
		id:       'array-sum',
		selector: `CallExpression${prop('callee', 'reduce')}[arguments.length=2][arguments.1.type="Literal"][arguments.1.value=0]`
			+ '[arguments.0.type="ArrowFunctionExpression"][arguments.0.params.length=2][arguments.0.body.type="BinaryExpression"][arguments.0.body.operator="+"]',
		capture:  { array: 'callee.object' },
		replace:  'arraySum({{array}})',
		helperIn: Files.arrays,
		sameText: [['arguments.0.params.0', 'arguments.0.body.left'], ['arguments.0.params.1', 'arguments.0.body.right']],
		message:  'Use `arraySum`, summing a list is not a place to spell out a fold.'
	},
	someInsteadOfFilter('some-instead-of-filter-length', true),
	someInsteadOfFilter('none-instead-of-filter-length', false)
];

export = patterns;
