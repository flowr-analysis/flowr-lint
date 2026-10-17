import { RType } from '../type';
import type { RArgument } from './r-argument';
import type { RSymbol } from './r-symbol';

export const EmptyArgument = '<>';

export type PotentiallyEmptyRArgument = RArgument | typeof EmptyArgument;

export interface RFunctionCall { type: RType.FunctionCall, named?: boolean, functionName: RSymbol, args: PotentiallyEmptyRArgument[] }

export const RFunctionCall = {
	is(node?: { type: RType }): node is RFunctionCall {
		return node?.type === RType.FunctionCall;
	},
	isNamed(node?: { type: RType }): node is RFunctionCall {
		return RFunctionCall.is(node) && node.named === true;
	},
	isUnnamed(node?: { type: RType }): node is RFunctionCall {
		return RFunctionCall.is(node) && !node.named;
	}
};
