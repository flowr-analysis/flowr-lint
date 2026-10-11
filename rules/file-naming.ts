import path from 'path';
import type { Rule } from 'eslint';

/** `dataflow-graph`, `Vertex`, `1-setup`, `r-bridge.test`: lower-case words, each optionally capitalized */
const fileName = /^(\d+-)?[A-Z]?[a-z]+([-.][A-Z]?[a-z]+)*$/;
const specFile = /\.spec\.[jt]sx?$/;

const rule: Rule.RuleModule = {
	meta: {
		type: 'layout',
		docs: {
			description: 'enforce the flowR file naming convention and keep spec files in the test folder',
			url:         'https://github.com/flowr-analysis/flowr-lint#flowrfile-naming'
		},
		schema:   [],
		messages: {
			name: 'The filename "{{ name }}" does not match {{ pattern }}',
			spec: 'The spec file "{{ name }}" belongs below test/'
		}
	},
	create(context) {
		return {
			Program(node) {
				const file = path.relative(context.cwd, context.physicalFilename).split(path.sep).join('/');
				const name = path.posix.basename(file);
				if(name.endsWith('.ts') && !fileName.test(name.slice(0, name.lastIndexOf('.')))) {
					context.report({ node, messageId: 'name', data: { name, pattern: String(fileName) } });
				}
				if(specFile.test(name) && !file.startsWith('test/')) {
					context.report({ node, messageId: 'spec', data: { name } });
				}
			}
		};
	}
};

export = rule;
