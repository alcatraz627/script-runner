/**
 * Lightweight JS syntax highlighter — regex-based, no dependencies.
 * Returns HTML string safe for {@html} usage (input is escaped first).
 */

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const JS_KEYWORDS = new Set([
	'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
	'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
	'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'module',
	'new', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try',
	'typeof', 'var', 'void', 'while', 'with', 'yield', 'require', 'exports',
]);

const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

interface Token {
	type: 'keyword' | 'literal' | 'string' | 'comment' | 'number' | 'fn' | 'text';
	value: string;
}

export function tokenize(code: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < code.length) {
		// Line comment
		if (code[i] === '/' && code[i + 1] === '/') {
			const end = code.indexOf('\n', i);
			const slice = end === -1 ? code.slice(i) : code.slice(i, end);
			tokens.push({ type: 'comment', value: slice });
			i += slice.length;
			continue;
		}

		// Block comment
		if (code[i] === '/' && code[i + 1] === '*') {
			const end = code.indexOf('*/', i + 2);
			const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
			tokens.push({ type: 'comment', value: slice });
			i += slice.length;
			continue;
		}

		// String (single, double, backtick)
		if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
			const quote = code[i];
			let j = i + 1;
			while (j < code.length && code[j] !== quote) {
				if (code[j] === '\\') j++; // skip escaped
				j++;
			}
			j++; // include closing quote
			tokens.push({ type: 'string', value: code.slice(i, j) });
			i = j;
			continue;
		}

		// Numbers
		if (/\d/.test(code[i]) && (i === 0 || /[\s=:,([\-+*/%!&|^~<>?;{}]/.test(code[i - 1]))) {
			let j = i;
			while (j < code.length && /[\d._eExXbBoOn]/.test(code[j])) j++;
			tokens.push({ type: 'number', value: code.slice(i, j) });
			i = j;
			continue;
		}

		// Word (keyword, literal, identifier)
		if (/[a-zA-Z_$]/.test(code[i])) {
			let j = i;
			while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
			const word = code.slice(i, j);
			// Check if followed by ( → function call
			const afterWord = code.slice(j).match(/^\s*\(/);
			if (JS_KEYWORDS.has(word)) {
				tokens.push({ type: 'keyword', value: word });
			} else if (JS_LITERALS.has(word)) {
				tokens.push({ type: 'literal', value: word });
			} else if (afterWord) {
				tokens.push({ type: 'fn', value: word });
			} else {
				tokens.push({ type: 'text', value: word });
			}
			i = j;
			continue;
		}

		// Everything else
		tokens.push({ type: 'text', value: code[i] });
		i++;
	}

	return tokens;
}

const classMap: Record<Token['type'], string> = {
	keyword: 'hl-keyword',
	literal: 'hl-literal',
	string: 'hl-string',
	comment: 'hl-comment',
	number: 'hl-number',
	fn: 'hl-fn',
	text: '',
};

export function highlightJS(code: string): string {
	const tokens = tokenize(code);
	return tokens.map(t => {
		const escaped = esc(t.value);
		const cls = classMap[t.type];
		if (!cls) return escaped;
		return `<span class="${cls}">${escaped}</span>`;
	}).join('');
}
