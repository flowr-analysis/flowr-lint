import type { Rule, Scope } from 'eslint';
import type { Identifier, MemberExpression, Node } from 'estree';
import type { TsSymbol, TsTypeChecker } from './ts-types';
import { declarationFile, isApplicable, suppressed, symbolOf, typeServices, useInsteadOf } from './util';

/** documentation is read once per symbol and reused for every reference */
const tagCache = new WeakMap<TsSymbol, string | null>();
/** the `@useInstead` tags of all members of a helper object, keyed by the object's symbol */
const memberCache = new WeakMap<TsSymbol, Map<string, string>>();

function cachedTag(symbol: TsSymbol, checker: TsTypeChecker): string | null {
	let tag = tagCache.get(symbol);
	if(tag === undefined) {
		tag = useInsteadOf(symbol, checker) ?? null;
		tagCache.set(symbol, tag);
	}
	return tag;
}

function cachedMemberTags(symbol: TsSymbol, checker: TsTypeChecker): Map<string, string> {
	const cached = memberCache.get(symbol);
	if(cached) {
		return cached;
	}
	const tags = new Map<string, string>();
	const declaration = symbol.declarations?.[0];
	if(declaration) {
		try {
			for(const property of checker.getTypeOfSymbolAtLocation(symbol, declaration).getProperties()) {
				const tag = useInsteadOf(property, checker);
				if(tag !== undefined) {
					tags.set(property.getName(), tag);
				}
			}
		} catch{
			/* nothing to check without a resolvable type */
		}
	}
	memberCache.set(symbol, tags);
	return tags;
}

/** `{@link Resolve.toValue}` becomes `Resolve.toValue`, owned by `Resolve`. */
function parseTarget(tag: string): { display: string, owner: string } {
	const display = tag.replace(/^\{\s*@link\s*/, '').replace(/\s*\|.*$/, '').replace(/\s*\}\s*$/, '').trim();
	return { display, owner: display.split('.')[0] };
}

/** The references that build the replacement in the first place: helper-object wiring and re-exports. */
function isWiring(identifier: Rule.Node): boolean {
	const parent = identifier.parent as Rule.Node | undefined;
	switch(parent?.type) {
		case 'Property':
			return parent.value === (identifier as Node) && (parent.parent as Rule.Node | undefined)?.type === 'ObjectExpression';
		case 'SpreadElement':
			return (parent.parent as Rule.Node | undefined)?.type === 'ObjectExpression';
		case 'ExportSpecifier':
		case 'ImportSpecifier':
		case 'ImportDefaultSpecifier':
		case 'ImportNamespaceSpecifier':
			return true;
		default:
			return false;
	}
}

const rule: Rule.RuleModule = {
	meta: {
		type:           'suggestion',
		fixable:        'code',
		hasSuggestions: true,
		docs:           {
			description: 'enforce the replacement named by the `@useInstead` documentation tag',
			url:         'https://github.com/flowr-analysis/flowr-lint#flowruse-instead'
		},
		schema: [{
			type:                 'object',
			properties:           { helperObjectPattern: { type: 'string' } },
			additionalProperties: false
		}],
		messages: {
			useInstead:      'Do not use `{{name}}` directly, use `{{replacement}}` instead.',
			useInsteadPlain: 'Do not use `{{name}}` directly, see its documentation for the replacement.',
			suggest:         'Replace with `{{replacement}}`.'
		}
	},
	create(context) {
		const services = typeServices(context);
		if(!services) {
			return {};
		}
		const checker = services.program.getTypeChecker();
		const sourceCode = context.sourceCode;
		/* helper objects are PascalCase, so member checks stay cheap */
		const helperObjectPattern = new RegExp((context.options[0] as { helperObjectPattern?: string } | undefined)?.helperObjectPattern ?? '^[A-Z]');
		const candidates = new Map<string, TsSymbol>();
		/** the helper objects declared here, a file may use what it wraps */
		const owned = new Set<string>();

		function report(node: Rule.Node, name: string, tag: string): void {
			const { display, owner } = parseTarget(tag);
			if(owned.has(owner) || suppressed(context, node, ['use-instead'])) {
				return;
			}
			const fix = (fixer: Rule.RuleFixer) => fixer.replaceText(node, display);
			/* fixed on the spot where the helper is already in scope, offered as a suggestion otherwise */
			const applicable = display !== '' && isApplicable(context, node, display);
			context.report({
				node,
				messageId: display ? 'useInstead' : 'useInsteadPlain',
				data:      { name, replacement: display },
				...display === '' ? {} : applicable ? { fix } : { suggest: [{ messageId: 'suggest', data: { replacement: display }, fix }] }
			});
		}

		return {
			Program() {
				const global = sourceCode.scopeManager.globalScope;
				const module = global?.childScopes.find(s => s.type === 'module') ?? global;
				const foreign: [Scope.Variable, Identifier, string][] = [];
				for(const variable of module?.variables ?? []) {
					const declaration = variable.defs[0]?.name;
					if(declaration?.type !== 'Identifier') {
						continue;
					}
					const symbol = symbolOf(declaration, services, checker);
					if(!symbol) {
						continue;
					} else if(declarationFile(symbol) === context.filename) {
						/* a declaration may always use itself */
						owned.add(variable.name);
						continue;
					}
					if(helperObjectPattern.test(variable.name)) {
						candidates.set(variable.name, symbol);
					}
					const tag = cachedTag(symbol, checker);
					if(tag !== null) {
						foreign.push([variable, declaration, tag]);
					}
				}
				for(const [variable, declaration, tag] of foreign) {
					for(const { identifier } of variable.references) {
						if(identifier !== declaration) {
							const node = identifier as Rule.Node;
							if(!isWiring(node)) {
								report(node, variable.name, tag);
							}
						}
					}
				}
			},
			MemberExpression(node: MemberExpression & Rule.NodeParentExtension) {
				if(node.computed || node.object.type !== 'Identifier' || node.property.type !== 'Identifier') {
					return;
				}
				const symbol = candidates.get(node.object.name);
				if(!symbol) {
					return;
				}
				const tag = cachedMemberTags(symbol, checker).get(node.property.name);
				if(tag !== undefined) {
					report(node, `${node.object.name}.${node.property.name}`, tag);
				}
			}
		};
	}
};

export = rule;
