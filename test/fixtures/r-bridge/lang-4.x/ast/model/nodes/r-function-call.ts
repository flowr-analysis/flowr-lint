import { RType } from '../type';

export const EmptyArgument = '<>';

export interface RFunctionCall { type: RType.FunctionCall, named?: boolean }

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
