/** The flowR-specific rules, see the README for the tags they read. */
import replacementPattern from './rules/replacement-pattern';
import useInstead from './rules/use-instead';
import fileNaming from './rules/file-naming';

const plugin = {
	meta:  { name: '@eagleoutice/eslint-config-flowr' },
	rules: {
		'use-instead':         useInstead,
		'replacement-pattern': replacementPattern,
		'file-naming':         fileNaming
	}
};

export = plugin;
