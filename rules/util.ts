/**
 * Shared helpers of the flowR rules.
 * Tags: `@useInstead <target>` names a replacement, `@performanceCritical` and `@lintIgnore [ids]` silence the rules.
 */
import type { Rule, Scope, SourceCode } from 'eslint';
import type { Comment, Node } from 'estree';
import type { TsSymbol, TsTypeChecker, TypeServices } from './ts-types';

const USE_INSTEAD_TAG = 'useInstead';
const SUPPRESS_TAGS = ['@performanceCritical', '@lintIgnore'];
/* ts.SymbolFlags.Alias, spelled out to keep typescript out of the dependencies */
const ALIAS_FLAG = 1 << 21;

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
	} else if(comment.value.includes('@performanceCritical')) {
		return true;
	}
	const ignore = /@lintIgnore([^\n@*]*)/.exec(comment.value);
	if(!ignore) {
		return false;
	}
	const listed = ignore[1].split(/[\s,]+/).filter(s => s.length > 0);
	return listed.length === 0 || listed.some(id => ids.includes(id));
}

/**
 * Whether `node` sits below a declaration documented with a suppressing tag, or in a file whose
 * header comment carries one. Guarded by one string search, so untagged files pay nothing.
 */
export function suppressed(context: Rule.RuleContext, node: Rule.Node, ids: readonly string[]): boolean {
	const sourceCode = context.sourceCode;
	if(!SUPPRESS_TAGS.some(tag => sourceCode.text.includes(tag))) {
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
		if(sourceCode.getCommentsBefore(documented as Node).some(c => silences(c, ids))) {
			return true;
		}
	}
	return false;
}

/** Resolves import aliases so the documentation of the original declaration is read. */
function resolveAlias(symbol: TsSymbol, checker: TsTypeChecker): TsSymbol {
	return (symbol.flags & ALIAS_FLAG) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/** The symbol an ESTree node resolves to, with import aliases followed. */
export function symbolOf(node: Node | undefined, services: TypeServices, checker: TsTypeChecker): TsSymbol | undefined {
	const tsNode = node ? services.esTreeNodeToTSNodeMap.get(node) : undefined;
	const symbol = tsNode ? checker.getSymbolAtLocation(tsNode) : undefined;
	return symbol ? resolveAlias(symbol, checker) : undefined;
}

/** The file a symbol is declared in. */
export function declarationFile(symbol: TsSymbol | undefined): string | undefined {
	return symbol?.declarations?.[0]?.getSourceFile()?.fileName;
}

/** The text of the `@useInstead` tag of a symbol, `undefined` if it carries none. */
export function useInsteadOf(symbol: TsSymbol, checker: TsTypeChecker): string | undefined {
	for(const tag of symbol.getJsDocTags(checker)) {
		if(tag.name === USE_INSTEAD_TAG) {
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
