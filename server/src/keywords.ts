import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';

// Keywords available all around the file
// A "sortText" key is added to each keyword object so that it won't mix up with import suggestions
const BASE_LVL_KEYWORDS: CompletionItem[] = [
	{
		label: "namespace",
		kind: CompletionItemKind.Keyword,
		detail: "namespace",
	},
	{
		label: "func",
		kind: CompletionItemKind.Keyword,
		detail: "function",
	},
	{
		label: "from",
		kind: CompletionItemKind.Keyword,
		detail: "from"
	},
	{
		label: "import",
		kind: CompletionItemKind.Keyword,
		detail: "import"
	},
	{
		label: "const",
		kind: CompletionItemKind.Keyword,
		detail: "const"
	},
	{

		label: "end",
		kind: CompletionItemKind.Keyword,
		detail: "end"
	},
	{
		label: "member",
		kind: CompletionItemKind.Keyword,
		detail: "struct member"
	},
	{
		label: "felt",
		kind: CompletionItemKind.Class,
		detail: "field element"
	},
	{
		label: "struct",
		kind: CompletionItemKind.Class,
		detail: "struct"
	},
	{
		label: "error_message",
		kind: CompletionItemKind.Class,
		detail: "error message"
	}
].map((kw) => Object.assign(kw, { sortText: "1" }));

// Keywords only available inside a function
const FUNC_LVL_KEYWORDS: CompletionItem[] = [
	{
		label: "const",
		kind: CompletionItemKind.Keyword,
		detail: "const"
	},
	{

		label: "let",
		kind: CompletionItemKind.Keyword,
		detail: "let"
	},
	{

		label: "local",
		kind: CompletionItemKind.Keyword,
		detail: "local"
	},
	{

		label: "if",
		kind: CompletionItemKind.Keyword,
		detail: "if"
	},
	{

		label: "else",
		kind: CompletionItemKind.Keyword,
		detail: "else"
	},
	{

		label: "end",
		kind: CompletionItemKind.Keyword,
		detail: "end"
	},
	{

		label: "return",
		kind: CompletionItemKind.Keyword,
		detail: "return"
	},
	{

		label: "assert",
		kind: CompletionItemKind.Keyword,
		detail: "assert"
	},
	{

		label: "with_attr",
		kind: CompletionItemKind.Keyword,
		detail: "with attribute"
	},

	{
		label: "felt",
		kind: CompletionItemKind.Class,
		detail: "field element"
	},
	{
		label: "struct",
		kind: CompletionItemKind.Class,
		detail: "struct"
	},
	{
		label: "error_message",
		kind: CompletionItemKind.Class,
		detail: "error message"
	},
	{
		label: "alloc_locals",
		kind: CompletionItemKind.Function,
		detail: "allocate locals"
	},
	{
		label: "alloc",
		kind: CompletionItemKind.Function,
		detail: "allocate"
	},
];

// Extension should both support Cairo and Starknet, seperate both
// Conventionally this includes only @ decorators
const BASE_STARKNET_KEYWORDS: CompletionItem[] = [
	{
		label: "storage_var",
		kind: CompletionItemKind.Property,
		detail: "storage variable"
	},
	{
		label: "view",
		kind: CompletionItemKind.Property,
		detail: "view"
	},
	{
		label: "external",
		kind: CompletionItemKind.Property,
		detail: "external"
	},
	{
		label: "l1_handler",
		kind: CompletionItemKind.Property,
		detail: "l1 handler"
	},
].map((kw) => Object.assign(kw, { sortText: "2" }));

export {
	FUNC_LVL_KEYWORDS, BASE_LVL_KEYWORDS, BASE_STARKNET_KEYWORDS
}
