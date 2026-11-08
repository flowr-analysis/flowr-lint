import type { Rule } from 'eslint';
import type { Node } from 'estree';
import type { TsType, TsTypeChecker } from './ts-types';
import { suppressed, typeServices } from './util';

/* ts.TypeFlags and ts.SymbolFlags, spelled out to keep typescript out of the dependencies */
const StringFlag = 1 << 2;
const NumberFlag = 1 << 3;
const UndefinedFlag = 1 << 15;
const NullFlag = 1 << 16;
const TypeParameterFlag = 1 << 18;

const BrandProperty = '__brand';
const Collections: ReadonlySet<string> = new Set(['Array', 'ReadonlyArray', 'Set', 'ReadonlySet', 'Map', 'ReadonlyMap', 'DefaultMap']);

function membersOf(type: TsType): readonly TsType[] {
	return (type.isUnion() ? type.types : [type]).filter(t => (t.flags & (UndefinedFlag | NullFlag)) === 0);
}

/** A semantic type carries a brand: `string & { __brand?: 'node-id' }`. */
function isSemantic(type: TsType, checker: TsTypeChecker): boolean {
	const members = membersOf(type);
	return members.length > 0 && members.every(t => checker.getPropertyOfType(t, BrandProperty) !== undefined);
}

function isPlainPrimitive(type: TsType, checker: TsTypeChecker): boolean {
	const members = membersOf(type);
	return members.length > 0 && members.every(t => (t.flags & (StringFlag | NumberFlag)) !== 0 && checker.getPropertyOfType(t, BrandProperty) === undefined);
}

function collectionArguments(type: TsType, checker: TsTypeChecker): readonly TsType[] | undefined {
	const [member] = membersOf(type);
	const name = member?.getSymbol()?.getName();
	return name !== undefined && Collections.has(name) ? checker.getTypeArguments(member) : undefined;
}

/** Whether a value of type `source` loses its meaning in a place of type `target`, on its own or inside a collection. */
function widens(source: TsType, target: TsType, checker: TsTypeChecker): boolean {
	if(isSemantic(source, checker)) {
		return isPlainPrimitive(target, checker);
	}
	const from = collectionArguments(source, checker);
	const to = collectionArguments(target, checker);
	return from !== undefined && to !== undefined && from.some((f, i) => to[i] !== undefined && widens(f, to[i], checker));
}

/** A parameter a library declares as a plain string takes any string, while one of a collection (`Set<string>`) states what the code chose. */
function acceptedByLibrary(call: Rule.Node, argument: Node, tsCall: unknown, checker: TsTypeChecker): boolean {
	if(call.type !== 'CallExpression' && call.type !== 'NewExpression') {
		return false;
	}
	const declaration = checker.getResolvedSignature(tsCall)?.declaration;
	if(declaration?.getSourceFile()?.fileName.includes('/node_modules/') !== true) {
		return false;
	}
	const parameters = declaration.parameters;
	const parameter = parameters?.[Math.min(call.arguments.indexOf(argument as never), parameters.length - 1)];
	return parameter !== undefined && (checker.getTypeAtLocation(parameter).flags & TypeParameterFlag) === 0;
}

const rule: Rule.RuleModule = {
	meta: {
		type:     'problem',
		docs:     { description: 'a value of a semantic type (NodeId, BrandedIdentifier, ...) must not silently become a plain string or number' },
		messages: {
			widens: 'This turns a {{source}} into a plain {{target}}. Use a semantic type for what receives it, or cast explicitly if the meaning really ends here.'
		},
		schema: []
	},
	create(context) {
		const services = typeServices(context);
		if(!services) {
			return {};
		}
		const checker = services.program.getTypeChecker();
		const check = (node: Node | null | undefined): void => {
			if(!node || node.type === 'SpreadElement') {
				return;
			}
			const tsNode = services.esTreeNodeToTSNodeMap.get(node);
			const target = checker.getContextualType(tsNode);
			if(target === undefined) {
				return;
			}
			const source = checker.getTypeAtLocation(tsNode);
			if(!widens(source, target, checker) || suppressed(context, node as Rule.Node, ['no-semantic-widening'])) {
				return;
			}
			const parent = (node as Rule.Node).parent as Rule.Node;
			if(acceptedByLibrary(parent, node, services.esTreeNodeToTSNodeMap.get(parent), checker)) {
				return;
			}
			context.report({ node, messageId: 'widens', data: { source: checker.typeToString(source), target: checker.typeToString(target) } });
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
