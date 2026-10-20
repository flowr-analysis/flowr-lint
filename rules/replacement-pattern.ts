import type { Rule } from 'eslint';
import type { Node } from 'estree';
import type { ReplacementPattern } from '../pattern-type';
import { declarationFile, insideReplacement, isApplicable, suppressed, symbolOf, typeServices } from './util';

/** Resolves a dotted path (`left.object`) relative to the matched node. */
function resolvePath(node: Node, path: string): Node | undefined {
	let current: unknown = node;
	for(const step of path.split('.')) {
		if(current === null || current === undefined) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[step];
	}
	return (current ?? undefined) as Node | undefined;
}

/**
 * Fills `{{name}}` with the source text of a capture and `{{name|last}}` with the part behind its
 * last dot. Returns `undefined` if a capture is missing.
 */
function render(template: string, captures: Readonly<Record<string, string>>, node: Node, sourceCode: Rule.RuleContext['sourceCode']): string | undefined {
	let failed = false;
	const filled = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*(?:\|\s*(last)\s*)?\}\}/g, (_all, name: string, filter?: string) => {
		const captured = captures[name] === undefined ? undefined : resolvePath(node, captures[name]);
		if(captured === undefined) {
			failed = true;
			return '';
		}
		const text = sourceCode.getText(captured);
		return filter === 'last' ? text.slice(text.lastIndexOf('.') + 1) : text;
	});
	return failed ? undefined : filled;
}

/** per program, whether one of its files matches a `helperIn` path; every file of a run shares the program */
const helperFiles = new WeakMap<object, Map<string, boolean>>();

function programHas(program: { getSourceFiles(): readonly { fileName: string }[] }, path: string): boolean {
	let known = helperFiles.get(program);
	if(known === undefined) {
		helperFiles.set(program, known = new Map<string, boolean>());
	}
	let has = known.get(path);
	if(has === undefined) {
		has = program.getSourceFiles().some(file => file.fileName.replaceAll('\\', '/').includes(path));
		known.set(path, has);
	}
	return has;
}

const rule: Rule.RuleModule = {
	meta: {
		type:           'suggestion',
		fixable:        'code',
		hasSuggestions: true,
		docs:           {
			description: 'suggest the flowR helper that replaces a hand-written pattern',
			url:         'https://github.com/flowr-analysis/flowr-lint#flowrreplacement-pattern'
		},
		schema: [{
			type:       'object',
			properties: {
				patterns: {
					type:  'array',
					items: {
						type:       'object',
						properties: {
							/** identifies the pattern in `@lintIgnore` and in the message */
							id:         { type: 'string' },
							/** esquery selector, the language `no-restricted-syntax` uses */
							selector:   { type: 'string' },
							message:    { type: 'string' },
							/** capture name to a path relative to the match */
							capture:    { type: 'object', additionalProperties: { type: 'string' } },
							/** replacement template, filled from the captures */
							replace:    { type: 'string' },
							/** path to a substring of the file its symbol must be declared in, this is what keeps the pattern flowR-specific */
							declaredIn: { type: 'object', additionalProperties: { type: 'string' } },
							/** path to a substring of the file the replacement's helper lives in, the pattern is silent in a program without it */
							helperIn:   { type: 'string' },
							/** pairs of paths that have to spell the same code, esquery has no back-references */
							sameText:   { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } },
							/** `true` forces the autofix, `false` forces a suggestion; by default it is fixed when the replacement is already in scope */
							fix:        { type: 'boolean' }
						},
						required:             ['selector', 'replace'],
						additionalProperties: false
					}
				}
			},
			additionalProperties: false
		}],
		messages: {
			replacement: '{{message}}',
			suggest:     'Replace with `{{replacement}}`.'
		}
	},
	create(context) {
		const sourceCode = context.sourceCode;
		const services = typeServices(context);
		const checker = services?.program.getTypeChecker();
		const patterns = (context.options[0] as { patterns?: readonly ReplacementPattern[] } | undefined)?.patterns ?? [];
		/* several patterns may share a selector, so they are grouped instead of overwriting each other */
		const bySelector = new Map<string, ReplacementPattern[]>();
		for(const pattern of patterns) {
			const group = bySelector.get(pattern.selector);
			if(group) {
				group.push(pattern);
			} else {
				bySelector.set(pattern.selector, [pattern]);
			}
		}

		/** The match only counts if every named node resolves to a declaration of the expected flowR file. */
		function isFlowr(node: Node, pattern: ReplacementPattern): boolean {
			if(pattern.helperIn !== undefined && (!services || !programHas(services.program, pattern.helperIn))) {
				return false;
			} else if(!pattern.declaredIn) {
				return true;
			} else if(!services || !checker) {
				return false;
			}
			return Object.entries(pattern.declaredIn).every(([path, expected]) => {
				const file = declarationFile(symbolOf(resolvePath(node, path), services, checker));
				return file !== undefined && file.replaceAll('\\', '/').includes(expected);
			});
		}

		/** esquery cannot demand that two sub-nodes are the same, so the pattern names the pairs itself */
		function agrees(node: Node, pattern: ReplacementPattern): boolean {
			return (pattern.sameText ?? []).every(([a, b]) => {
				const left = resolvePath(node, a), right = resolvePath(node, b);
				return left !== undefined && right !== undefined && sourceCode.getText(left) === sourceCode.getText(right);
			});
		}

		function check(node: Rule.Node, pattern: ReplacementPattern): void {
			const ids = [pattern.id, 'replacement-pattern'].filter(id => id !== undefined);
			if(!agrees(node, pattern) || !isFlowr(node, pattern) || suppressed(context, node, ids)) {
				return;
			}
			const captures = pattern.capture ?? {};
			const replacement = render(pattern.replace, captures, node, sourceCode);
			const message = (pattern.message === undefined ? undefined : render(pattern.message, captures, node, sourceCode))
				?? (replacement ? `Use \`${replacement}\` here.` : `\`${pattern.id ?? pattern.selector}\` has a helper replacement.`);
			if(replacement !== undefined && insideReplacement(node, replacement, sourceCode, services)) {
				return;
			} else if(replacement === undefined) {
				context.report({ node, messageId: 'replacement', data: { message } });
				return;
			}
			const fix = (fixer: Rule.RuleFixer) => fixer.replaceText(node, replacement);
			/* fixed on the spot where the helper is already in scope, offered as a suggestion otherwise */
			const applicable = pattern.fix ?? isApplicable(context, node, replacement);
			context.report({
				node,
				messageId: 'replacement',
				data:      { message },
				...applicable ? { fix } : { suggest: [{ messageId: 'suggest', data: { replacement }, fix }] }
			});
		}

		const listeners: Rule.RuleListener = {};
		for(const [selector, group] of bySelector) {
			listeners[selector] = (node: Rule.Node) => group.forEach(pattern => check(node, pattern));
		}
		return listeners;
	}
};

export = rule;
