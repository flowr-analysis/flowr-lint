/**
 * Shared helpers of the flowR rules.
 * Tags: `@useInstead <target>` names a replacement, `@lintIgnore [ids]` silences the rules.
 */
import type { Rule, Scope, SourceCode } from 'eslint';
import type { Comment, Node } from 'estree';
import type { TsSymbol, TsTypeChecker, TypeServices } from './ts-types';

const UseInsteadTag = 'useInstead';
const SuppressTag = '@lintIgnore';
/* ts.SymbolFlags.Alias, spelled out to keep typescript out of the dependencies */
const AliasFlag = 1 << 21;

/** The type-aware services, or `undefined` if the file is parsed without a program. */
export function typeServices(context: Rule.RuleContext): TypeServices | undefined {
	const services = context.sourceCode.parserServices as Partial<TypeServices> | undefined;
	return services?.program && services.esTreeNodeToTSNodeMap ? services as TypeServices : undefined;
}

function isDocComment(comment: Comment): boolean {
	return comment.type === 'Block' && comment.value.startsWith('*');
}

/** Whether the documentation comment silences the given rule or pattern id. */
function silences(comment: Comment, ids: readonly string[]): boolean {
	if(!isDocComment(comment)) {
		return false;
	}
	const ignore = /@lintIgnore([^\n@*]*)/.exec(comment.value);
	if(!ignore) {
		return false;
	}
	const listed = ignore[1].split(/[\s,]+/).filter(s => s.length > 0);
	return listed.length === 0 || listed.some(id => ids.includes(id));
}

/**
 * Whether `node` sits below a declaration documented with `@lintIgnore`, or in a file whose header comment
 * carries it. Guarded by one string search, so untagged files pay nothing.
 */
export function suppressed(context: Rule.RuleContext, node: Rule.Node, ids: readonly string[]): boolean {
	const sourceCode = context.sourceCode;
	if(!sourceCode.text.includes(SuppressTag)) {
		return false;
	}
	/* a header comment marks the whole file: above the imports, or separated by a blank line */
	const first = sourceCode.getAllComments()[0];
	const top = sourceCode.ast.body[0];
	if(first?.range && top?.range && first.range[1] < top.range[0]
		&& (top.type === 'ImportDeclaration' || /\n\s*\n/.test(sourceCode.text.slice(first.range[1], top.range[0])))
		&& silences(first, ids)) {
		return true;
	}
	for(let current: Rule.Node | null | undefined = node; current; current = current.parent) {
		/* `export function f()` carries its documentation on the export */
		const parent = current.parent as Rule.Node | undefined;
		const documented = parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration' ? parent : current;
		if(sourceCode.getCommentsBefore(documented).some(c => silences(c, ids))) {
			return true;
		}
	}
	return false;
}

/** Resolves import aliases so the documentation of the original declaration is read. */
function resolveAlias(symbol: TsSymbol, checker: TsTypeChecker): TsSymbol {
	return (symbol.flags & AliasFlag) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/** The symbol an ESTree node resolves to, with import aliases followed. */
export function symbolOf(node: Node | undefined, services: TypeServices, checker: TsTypeChecker): TsSymbol | undefined {
	const tsNode = node ? services.esTreeNodeToTSNodeMap.get(node) : undefined;
	const symbol = tsNode ? checker.getSymbolAtLocation(tsNode) : undefined;
	return symbol ? resolveAlias(symbol, checker) : undefined;
}

/** the name node a function is declared or bound under: a declaration, a member of an object or class, a variable, or an assignment */
function nameOf(fn: Node, parent: Node | undefined): Node | undefined {
	if((fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') && fn.id) {
		return fn.id;
	}
	switch(parent?.type) {
		case 'Property': case 'MethodDefinition': case 'PropertyDefinition':
			return parent.key;
		case 'VariableDeclarator':
			return parent.id;
		case 'AssignmentExpression':
			return parent.left.type === 'MemberExpression' ? parent.left.property : parent.left;
		default:
			return undefined;
	}
}

/** a symbol together with what it is bound to, so `frames` of `{ frames: framesOf }` also stands for `framesOf` */
function boundTo(symbol: TsSymbol | undefined, checker: TsTypeChecker): TsSymbol[] {
	if(symbol === undefined) {
		return [];
	}
	const declaration = symbol.declarations?.[0];
	const value = declaration?.initializer === undefined ? declaration && checker.getShorthandAssignmentValueSymbol(declaration) : checker.getSymbolAtLocation(declaration.initializer);
	return value === undefined ? [symbol] : [symbol, resolveAlias(value, checker)];
}

/* per program, what its modules export under a name, for a replacement the file does not import yet */
const exportedNames = new WeakMap<object, Map<string, TsSymbol | undefined>>();

/** what `name` stands for at `node`: what is in scope there, else what a module of the program exports under it */
function rootSymbol(name: string, node: Node, sourceCode: SourceCode, services: TypeServices): TsSymbol | undefined {
	const checker = services.program.getTypeChecker();
	let scope: Scope.Scope | null = sourceCode.getScope(node);
	while(scope && !scope.set.has(name)) {
		scope = scope.upper;
	}
	if(scope) {
		return symbolOf(scope.set.get(name)?.defs[0]?.name, services, checker);
	}
	let known = exportedNames.get(services.program);
	if(known === undefined) {
		exportedNames.set(services.program, known = new Map());
	}
	if(!known.has(name)) {
		const modules = services.program.getSourceFiles().map(file => checker.getSymbolAtLocation(file)).filter(m => m !== undefined);
		known.set(name, modules.flatMap(m => checker.getExportsOfModule(m)).find(e => e.getName() === name));
	}
	return known.get(name);
}

/** the properties of what a symbol holds */
function propertiesOf(symbol: TsSymbol | undefined, checker: TsTypeChecker): readonly TsSymbol[] {
	const declaration = symbol?.declarations?.[0];
	return symbol === undefined || declaration === undefined ? [] : checker.getTypeOfSymbolAtLocation(symbol, declaration).getProperties();
}

/** each link of a dotted name, `Dataflow.origin`, as the symbols it resolves to: the name and what it is bound to */
function resolveChain(chain: string, node: Node, sourceCode: SourceCode, services: TypeServices): TsSymbol[][] {
	const checker = services.program.getTypeChecker();
	const [root, ...members] = chain.split('.');
	const links = [boundTo(rootSymbol(root, node, sourceCode, services), checker)];
	for(const member of members) {
		links.push(boundTo(propertiesOf(links[links.length - 1][0], checker).find(p => p.getName() === member), checker));
	}
	return links;
}

/** Every symbol the dotted names of a replacement resolve to, `REnvironment.frames` to `REnvironment`, its `frames`, and the function that member is bound to. */
function symbolsNamedBy(replacement: string, node: Node, sourceCode: SourceCode, services: TypeServices): Set<TsSymbol> {
	return new Set((replacement.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) ?? []).flatMap(chain => resolveChain(chain, node, sourceCode, services).flat()));
}

/**
 * The member of `replacement` that takes the place of `member` of `original`: the one of the same name, else the one
 * bound to the same function under another name. `undefined` if the replacement has none, `null` if it cannot be told.
 */
export function counterpartOf(original: Node, member: string, replacement: string, sourceCode: SourceCode, services: TypeServices): string | undefined | null {
	const checker = services.program.getTypeChecker();
	const target = resolveChain(replacement, original, sourceCode, services).at(-1)?.[0];
	if(target === undefined) {
		return null;
	}
	const offered = propertiesOf(target, checker);
	const was = boundTo(propertiesOf(symbolOf(original, services, checker), checker).find(p => p.getName() === member), checker);
	return (offered.find(p => p.getName() === member) ?? offered.find(p => boundTo(p, checker).some(s => was.includes(s))))?.getName();
}

/**
 * Whether `node` sits in a function the replacement would call, where putting the replacement in would make that
 * function call itself. A replacement can only call what it names: a function is excluded if it is declared or bound
 * under one of those names, or, with types, if one of them resolves to it, wired up under another name or in another
 * file. Both ask the code alone, never file paths, which differ between systems and how a file was opened.
 */
export function insideReplacement(node: Node, replacement: string, sourceCode: SourceCode, services?: TypeServices): boolean {
	const names = new Set(replacement.match(/[A-Za-z_$][\w$]*/g) ?? []);
	const ancestors = sourceCode.getAncestors(node);
	const functions = ancestors.flatMap((fn, i) => fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression' || fn.type === 'ArrowFunctionExpression' ? [nameOf(fn, ancestors[i - 1])] : [])
		.filter((name): name is Node => name !== undefined);
	if(functions.some(name => name.type === 'Identifier' && names.has(name.name))) {
		return true;
	}
	if(services === undefined || functions.length === 0) {
		return false;
	}
	const called = symbolsNamedBy(replacement, node, sourceCode, services);
	const checker = services.program.getTypeChecker();
	return functions.some(name => boundTo(symbolOf(name, services, checker), checker).some(symbol => called.has(symbol)));
}

/** The file a symbol is declared in. */
export function declarationFile(symbol: TsSymbol | undefined): string | undefined {
	return symbol?.declarations?.[0]?.getSourceFile()?.fileName;
}

/** The text of the `@useInstead` tag of a symbol, `undefined` if it carries none. */
export function useInsteadOf(symbol: TsSymbol, checker: TsTypeChecker): string | undefined {
	for(const tag of symbol.getJsDocTags(checker)) {
		if(tag.name === UseInsteadTag) {
			return (tag.text ?? []).map(p => p.text).join('').trim();
		}
	}
	return undefined;
}

/** the names a chunk of code depends on: the root of every member chain, `a.b(c)` gives `a` and `c` */
function rootNames(text: string): Set<string> {
	const names = new Set<string>();
	for(const [, name] of text.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)/g)) {
		names.add(name);
	}
	return names;
}

function isValueInScope(sourceCode: SourceCode, node: Node, name: string): boolean {
	for(let scope: Scope.Scope | null = sourceCode.getScope(node); scope; scope = scope.upper) {
		const variable = scope.set.get(name);
		if(variable) {
			/* a type-only binding of the same name is in scope but cannot be used as a value */
			/* `Type` is typescript-eslint's own definition kind, which eslint's types do not know about */
			return variable.defs.some(d => (d.type as string) !== 'Type'
				&& !(d.type === 'ImportBinding' && (isTypeOnly(d.node) || isTypeOnly(d.parent))));
		}
	}
	return false;
}

function isTypeOnly(node: unknown): boolean {
	return (node as { importKind?: string } | undefined)?.importKind === 'type';
}

/**
 * Whether the replacement can be applied on the spot: every name it adds over the matched code has to be
 * bound already and usable as a value, a fixer cannot add the import that would be missing otherwise.
 */
export function isApplicable(context: Rule.RuleContext, node: Node, replacement: string): boolean {
	const present = rootNames(context.sourceCode.getText(node));
	return [...rootNames(replacement)].every(name => present.has(name) || isValueInScope(context.sourceCode, node, name));
}
