/** The flowR-specific rules, see the README for the tags they read. */
import replacementPattern from './rules/replacement-pattern';
import useInstead from './rules/use-instead';

const plugin = {
	meta:  { name: '@eagleoutice/eslint-config-flowr' },
	rules: {
		'use-instead':         useInstead,
		'replacement-pattern': replacementPattern
	}
};

export = plugin;
