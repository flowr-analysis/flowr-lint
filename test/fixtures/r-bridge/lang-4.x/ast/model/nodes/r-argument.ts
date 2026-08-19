import { RType } from '../type';

export interface RArgument { type: RType.Argument, name?: string, value?: unknown }

export const RArgument = {
	is(node?: { type: RType }): node is RArgument {
		return node?.type === RType.Argument;
	},
	isEmpty(node: unknown): boolean {
		return node === '<>';
	},
	isNotEmpty(node: unknown): boolean {
		return node !== '<>';
	},
	isNamed(node?: { type: RType }): node is RArgument {
		return RArgument.is(node) && node.name !== undefined;
	},
	isWithValue(node?: { type: RType }): node is RArgument {
		return RArgument.is(node) && node.value !== undefined;
	}
};
