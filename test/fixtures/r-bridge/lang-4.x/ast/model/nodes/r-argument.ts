import { RType } from '../type';
import type { RSymbol } from './r-symbol';

export interface RArgument { type: RType.Argument, name?: RSymbol, value?: unknown }

export const RArgument = {
	is(node?: { type: RType }): node is RArgument {
		return node?.type === RType.Argument;
	},
	isEmpty(node: unknown): node is '<>' {
		return node === '<>';
	},
	isNotEmpty<T>(node: T): node is Exclude<T, '<>'> {
		return node !== '<>';
	},
	isNamed(node?: { type: RType }): node is RArgument {
		return RArgument.is(node) && node.name !== undefined;
	},
	isWithValue(node?: { type: RType }): node is RArgument {
		return RArgument.is(node) && node.value !== undefined;
	}
};
