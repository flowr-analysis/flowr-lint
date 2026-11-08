import type { Rule } from 'eslint';
import type { Node } from 'estree';
import type { TsSymbol, TsType, TsTypeChecker } from './ts-types';
import { suppressed, typeServices } from './util';

/* ts.TypeFlags and ts.SymbolFlags, spelled out to keep typescript out of the dependencies */
const StringFlag = 1 << 2;
const NumberFlag = 1 << 3;
const VoidFlag = 1 << 14;
const UndefinedFlag = 1 << 15;
const NullFlag = 1 << 16;
const TypeParameterFlag = 1 << 18;
const ReferenceFlag = 1 << 2;
const StringIndex = 0;

const BrandProperty = '__brand';
const Collections: ReadonlySet<string> = new Set(['Array', 'ReadonlyArray', 'Set', 'ReadonlySet', 'Map', 'ReadonlyMap', 'DefaultMap', 'Iterable']);

function membersOf(type: TsType): readonly TsType[] {
	return (type.isUnion() ? type.types : [type]).filter(t => (t.flags & (UndefinedFlag | NullFlag)) === 0);
}

/** A semantic type carries a brand: `string & { __brand?: 'node-id' }`. One member of a union is enough, `NodeId | boolean` still holds an id. */
function isSemantic(type: TsType, checker: TsTypeChecker): boolean {
	return membersOf(type).some(t => checker.getPropertyOfType(t, BrandProperty) !== undefined);
}

function allowsPlainPrimitive(type: TsType): boolean {
	return membersOf(type).some(t => (t.flags & (StringFlag | NumberFlag)) !== 0);
}

function collectionArguments(type: TsType, checker: TsTypeChecker): readonly TsType[] | undefined {
	const [member] = membersOf(type);
	const name = member?.getSymbol()?.getName();
	return name !== undefined && Collections.has(name) ? checker.getTypeArguments(member) : undefined;
}

/** Whether a value of type `source` loses its meaning in a place of type `target`, on its own or inside a collection. */
function widens(source: TsType, target: TsType, checker: TsTypeChecker): boolean {
	if(isSemantic(source, checker)) {
		return !isSemantic(target, checker) && allowsPlainPrimitive(target);
	}
	const from = collectionArguments(source, checker);
	const to = collectionArguments(target, checker);
	return from !== undefined && to !== undefined && from.some((f, i) => to[i] !== undefined && widens(f, to[i], checker));
}

/** Whether a parameter's declared type is left to the caller, like `T`, `...items: T[]`, or `Iterable<K>`. */
function mentionsTypeParameter(type: TsType, checker: TsTypeChecker, depth = 2): boolean {
	if((type.flags & TypeParameterFlag) !== 0) {
		return true;
	} else if(type.isUnion()) {
		return type.types.some(member => mentionsTypeParameter(member, checker, depth));
	}
	return depth > 0 && ((type.objectFlags ?? 0) & ReferenceFlag) !== 0 && checker.getTypeArguments(type).some(a => mentionsTypeParameter(a, checker, depth - 1));
}

/**
 * A parameter a library declares as a plain string takes any string, while one of a collection (`Set<string>`) states what the code chose.
 * An inline array literal only asks whether a value is among some strings, like a comparison, with no declaration to retype.
 * A library call returning nothing, like `assert.strictEqual(id, 'x')`, keeps nothing, whatever its type parameters inferred.
 */
function acceptedByLibrary(call: Rule.Node, argument: Node, tsCall: unknown, checker: TsTypeChecker): boolean {
	if(call.type !== 'CallExpression' && call.type !== 'NewExpression') {
		return false;
	}
	if(call.callee.type === 'MemberExpression' && call.callee.object.type === 'ArrayExpression') {
		return true;
	}
	const signature = checker.getResolvedSignature(tsCall);
	const declaration = signature?.declaration;
	if(signature === undefined || declaration?.getSourceFile()?.fileName.includes('/node_modules/') !== true) {
		return false;
	}
	const parameters = declaration.parameters;
	const parameter = parameters?.[Math.min(call.arguments.indexOf(argument as never), parameters.length - 1)];
	return parameter !== undefined && (!mentionsTypeParameter(checker.getTypeAtLocation(parameter), checker) || (checker.getReturnTypeOfSignature(signature).flags & VoidFlag) !== 0);
}

const rule: Rule.RuleModule = {
	meta: {
		type:     'problem',
		docs:     { description: 'a value of a semantic type (NodeId, BrandedIdentifier, ...) must not silently become a plain string or number' },
		messages: {
			widens: 'This turns a {{source}} into a plain {{target}}. Use a semantic type for what receives it, or `String(x)` if the meaning really ends here.'
		},
		schema: []
	},
	create(context) {
		const services = typeServices(context);
		if(!services) {
			return {};
		}
		const checker = services.program.getTypeChecker();
		const report = (node: Node, source: TsType, target: TsType): void => {
			if(widens(source, target, checker) && !suppressed(context, node as Rule.Node, ['no-semantic-widening'])) {
				context.report({ node, messageId: 'widens', data: { source: checker.typeToString(source), target: checker.typeToString(target) } });
			}
		};
		const check = (node: Node | null | undefined): void => {
			if(!node || node.type === 'SpreadElement') {
				return;
			}
			const tsNode = services.esTreeNodeToTSNodeMap.get(node);
			const target = checker.getContextualType(tsNode);
			if(target === undefined) {
				return;
			}
			const parent = (node as Rule.Node).parent as Rule.Node;
			if(!acceptedByLibrary(parent, node, services.esTreeNodeToTSNodeMap.get(parent), checker)) {
				report(node, checker.getTypeAtLocation(tsNode), target);
			}
		};
		/* `f(...ids)` has no contextual type, what receives it is the rest parameter of the resolved signature */
		const checkArgumentSpread = (call: Rule.Node & { arguments: readonly Node[] }, spread: Node, argument: Node): void => {
			const tsCall = services.esTreeNodeToTSNodeMap.get(call);
			const parameters = checker.getResolvedSignature(tsCall)?.getParameters?.();
			const parameter = parameters?.[Math.min(call.arguments.indexOf(spread), parameters.length - 1)];
			if(parameter !== undefined && !acceptedByLibrary(call, spread, tsCall, checker)) {
				report(argument, checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(argument)), checker.getTypeOfSymbolAtLocation(parameter, tsCall));
			}
		};
		/* `{ ...named }` copies each property to the property of the same name */
		const checkObjectSpread = (argument: Node): void => {
			const tsNode = services.esTreeNodeToTSNodeMap.get(argument);
			const target = checker.getContextualType(tsNode);
			if(target === undefined) {
				return;
			}
			const typeOf = (property: TsSymbol): TsType => checker.getTypeOfSymbolAtLocation(property, tsNode);
			const pairs = checker.getTypeAtLocation(tsNode).getProperties().flatMap(from => {
				const to = checker.getPropertyOfType(target, from.getName());
				return to === undefined ? [] : [[typeOf(from), typeOf(to)] as const];
			});
			const widened = pairs.find(([from, to]) => widens(from, to, checker));
			if(widened) {
				report(argument, widened[0], widened[1]);
			}
		};
		/* a key used on a `Record<string, ...>` loses its meaning just like a value does, arrays are left alone since they index by position */
		const checkKey = (key: Node, owner: TsType | undefined): void => {
			const index = owner && membersOf(owner).map(member => checker.getIndexInfoOfType(member, StringIndex)).find(info => info !== undefined);
			if(index !== undefined) {
				report(key, checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(key)), index.keyType);
			}
		};
		const checkArguments = (call: { arguments: readonly Node[] }): void => call.arguments.forEach(check);
		return {
			CallExpression:   checkArguments,
			NewExpression:    checkArguments,
			ReturnStatement:  node => check(node.argument),
			VariableDeclarator(node) {
				check(node.init);
			},
			AssignmentExpression(node) {
				if(node.operator === '=') {
					check(node.right);
				}
			},
			Property(node) {
				check(node.value);
				if(node.computed && node.parent.type === 'ObjectExpression') {
					checkKey(node.key, checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node.parent)));
				}
			},
			MemberExpression(node) {
				if(node.computed) {
					checkKey(node.property, checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node.object)));
				}
			},
			SpreadElement(node) {
				const parent = node.parent as Rule.Node;
				if(parent.type === 'ArrayExpression') {
					check(node.argument);
				} else if(parent.type === 'ObjectExpression') {
					checkObjectSpread(node.argument);
				} else if(parent.type === 'CallExpression' || parent.type === 'NewExpression') {
					checkArgumentSpread(parent, node, node.argument);
				}
			},
			ArrayExpression(node) {
				node.elements.forEach(check);
			},
			AssignmentPattern(node) {
				check(node.right);
			},
			PropertyDefinition(node) {
				check(node.value as Node | null);
			},
			YieldExpression(node) {
				check(node.argument);
			},
			ArrowFunctionExpression(node) {
				if(node.body.type !== 'BlockStatement') {
					check(node.body);
				}
			}
		};
	}
};

export = rule;
