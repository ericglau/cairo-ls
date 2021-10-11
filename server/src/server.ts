import { stringify } from 'querystring';
/* --------------------------------------------------------------------------------------------
 * Copyright for portions from https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample 
 * are held by (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * 
 * Copyright (c) 2021 Eric Lau. All rights reserved. 
 * Licensed under the Eclipse Public License v2.0
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	CodeAction,
	CodeActionKind,
	CodeActionParams,
	CodeActionContext,
	WorkspaceEdit,
	HoverParams,
	Hover,
	Position
} from 'vscode-languageserver';

import {
	TextDocument, Range, TextEdit
} from 'vscode-languageserver-textdocument';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

const NAME: string = 'Cairo LS';

const DIAGNOSTIC_TYPE_COMPILE_ERROR: string = 'CompileError';

let cairoTempIndexFile: string;
const CAIRO_TEMP_FILE_NAME = "temp.cairo";

const { exec } = require("child_process");

const { indexOfRegex, lastIndexOfRegex } = require('index-of-regex')

const fs = require('fs')
const os = require('os')
const path = require('path')

let tempFolder: string;

connection.onInitialize((params: InitializeParams) => {

	fs.mkdtemp(path.join(os.tmpdir(), 'cairo-ls-'), (err: string, folder: string) => {
		if (err) {
			connection.console.error(err);
			throw err;
		}
		tempFolder = folder;
		cairoTempIndexFile = path.join(tempFolder, CAIRO_TEMP_FILE_NAME);
		connection.console.log("Temp folder: " + tempFolder);
	});

	let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true
			},
			/*			codeLensProvider : {
							resolveProvider: true
						},
			,*/
			hoverProvider: {
				workDoneProgress: false
			},
			codeActionProvider: {
				codeActionKinds: [CodeActionKind.QuickFix]
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}

	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

interface CairoLSSettings {
	maxNumberOfProblems: number;
	useVenv: boolean;
	venvCommand: string;
}

const DEFAULT_MAX_PROBLEMS = 100;
const DEFAULT_USE_VENV = true;
const DEFAULT_VENV_COMMAND = ". ~/cairo_venv/bin/activate";


let defaultSettings: CairoLSSettings = { maxNumberOfProblems: DEFAULT_MAX_PROBLEMS, useVenv: DEFAULT_USE_VENV, venvCommand: DEFAULT_VENV_COMMAND };
let globalSettings: CairoLSSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<CairoLSSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <CairoLSSettings>(
			(change.settings.cairols || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<CairoLSSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'cairols'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {

	let textDocumentFromURI = documents.get(textDocument.uri)
	let textDocumentContents = textDocumentFromURI?.getText()

	// In this simple example we get the settings for every validate run.
	let settings = await getDocumentSettings(textDocument.uri);

	let diagnostics: Diagnostic[] = [];

	// Compile temp file instead of this current file

	fs.writeFile(cairoTempIndexFile, textDocumentContents, function (err: any) {
		if (err) {
			connection.console.error(`Failed to write temp source file: ${err}`);
			return;
		}
		connection.console.log(`Temp source file ${cairoTempIndexFile} saved!`);
	});

	var commandPrefix = "";
	if (settings.useVenv && settings.venvCommand != null && settings.venvCommand.length > 0) {
		commandPrefix = settings.venvCommand + " && ";
	}

	await exec(commandPrefix + "cd " + tempFolder + " && cairo-compile " + CAIRO_TEMP_FILE_NAME + " --output temp_compiled.json", (error: { message: any; }, stdout: any, stderr: any) => {
		if (error) {
			connection.console.log(`Found compile error: ${error.message}`);
			let errorLocations: ErrorLocation[] = findErrorLocations(error.message);
			let problems = 0;
			for (var i = 0; i < errorLocations.length; i++) {
				let element: ErrorLocation = errorLocations[i];
				connection.console.log(`Displaying error message: ` + element.errorMessage);
				let maxProblems = settings?.maxNumberOfProblems || DEFAULT_MAX_PROBLEMS;
				if (problems < maxProblems) {
					problems++;

					addDiagnostic(element, `${element.errorMessage}`, 'Cairo compilation encountered an error.', DiagnosticSeverity.Error, DIAGNOSTIC_TYPE_COMPILE_ERROR + (element.suggestions != undefined ? element.suggestions : ""));
				}
			}

			return;
		}
		connection.console.log(`Cairo compiler output: ${stdout}`);
	});

	// Send the computed diagnostics to VSCode (before the above promise finishes, just to clear stuff).
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

	function addDiagnostic(element: ErrorLocation, message: string, details: string, severity: DiagnosticSeverity, code: string | undefined) {
		let diagnostic: Diagnostic = {
			severity: severity,
			range: element.range,
			message: message,
			source: NAME,
			code: code
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: details
				}
			];
		}
		diagnostics.push(diagnostic);

		// Send the computed diagnostics to VSCode.
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
	}
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

export interface ErrorLocation {
	range: Range;
	errorMessage: string;
	suggestions: string | undefined; // e.g. literally this whole thing: "a", "b", "c" (do not include trailing period from sentence)
}

function findErrorLocations(compileErrors: string): ErrorLocation[] {

	// Example output to parse
	/*

Command failed: cd /var/folders/5v/nrjqxr7s3l5g1mm1l2ngjg8r0000gn/T/cairo-ls-5PZ7P0 && cairo-compile temp.cairo --output temp_compiled.json
temp.cairo:2:15: Unexpected token Token(IDENTIFIER, 'aa0'). Expected one of: ".", ";", "[", operator.
    [ap] = 100aa0; ap++
              ^*^

	*/

	let pattern = /\n.*/gs  // start at the second line
	let m: RegExpExecArray | null;

	let locations: ErrorLocation[] = [];
	if (m = pattern.exec(compileErrors)) {
		connection.console.log(`Found pattern: ${m}`);

		// ERROR MESSAGE m:
		// temp.cairo:2:15: Unexpected token Token(IDENTIFIER, 'aa0'). Expected one of: ".", ";", "[", operator.

		var start: Position;
		var end: Position;

		// ----- get problem length -----
		var lines = m[0].split('\n');
		var problemLength;
		if (lines.length < 4) {
			connection.console.log(`Could not determine problem length`);
			problemLength = -1;
		} else {
			var arrowsLine = lines[3];
			var trimmedArrows = arrowsLine.trim();
			problemLength = trimmedArrows.length;
			connection.console.log(`Problem length: ${problemLength}`);	
		}
		// ------------------------------

		// Get actual message portion after the line and position numbers
		var tokens = m[0].split(':');
		
		//connection.console.log(`Tokens: ` + tokens);
		var linePos = parseInt(tokens[1]);
		var charPos = parseInt(tokens[2]);
		var actualMessage = "";
		if (isNaN(linePos) || isNaN(charPos)) { // no line/pos found - treat as generic error
			for (var i = 1; i < tokens.length; i++) { // start after "error"
				actualMessage += tokens[i];
				if (i < (tokens.length - 1)) {
					actualMessage += ":"; // add back the colons in between
				}
			}

			start = { line: 0, character: 0 }; // generic error highlights everything
			end = { line: 9999, character: 9999 };
		} else {
			for (var i = 3; i < tokens.length; i++) { // start after line/pos
				actualMessage += tokens[i];
				if (i < (tokens.length - 1)) {
					actualMessage += ":"; // add back the colons in between
				}
			}

			start = { line: linePos - 1, character: charPos - 1} // Cairo compiler numbers starts at 1

			connection.console.log(`actualMessage: ${actualMessage}`);

			// Get list of suggestions from compiler
			const MULTI_SUGGESTION_PREFIX = "Expected one of: ";
			const MULTI_SUGGESTION_SUFFIX = ","; // last suggestion is (usually?) "operator" so ignore it for now
			var indexOfSuggestions = actualMessage.indexOf(MULTI_SUGGESTION_PREFIX);
			var suggestions;
			if (indexOfSuggestions != -1) {
				suggestions = actualMessage.substring(indexOfSuggestions + MULTI_SUGGESTION_PREFIX.length, actualMessage.lastIndexOf(MULTI_SUGGESTION_SUFFIX));
			} else {
				// Try getting a single suggestion
				const SINGLE_SUGGESTION_PREFIX = "Expected: ";
				indexOfSuggestions = actualMessage.indexOf(SINGLE_SUGGESTION_PREFIX);
				if (indexOfSuggestions != -1) {
					suggestions = actualMessage.substring(indexOfSuggestions + SINGLE_SUGGESTION_PREFIX.length, actualMessage.indexOf("\n")); // up to the end of the line
				}
			}
			if (suggestions != null && suggestions.endsWith(".")) {
				suggestions = suggestions.substring(0, suggestions.length - 1); // remove trailing period from sentence
			}
			connection.console.log(`Parsed suggestions: ${suggestions}`);

			if (problemLength == -1) {
				end = { line: linePos, character: 0 };
			} else {
				end = { line: linePos - 1, character: charPos - 1 + problemLength };
			}
		}

		let location: ErrorLocation = {
			range: {
				start: start,
				end: end
			},
			errorMessage: actualMessage,
			suggestions: suggestions
		};
		locations.push(location);
	}
	return locations;
}

connection.onCodeAction(
	async (_params: CodeActionParams): Promise<CodeAction[]> => {
		let codeActions: CodeAction[] = [];

		let textDocument = documents.get(_params.textDocument.uri)
		if (textDocument === undefined) {
			return codeActions;
		}
		let context: CodeActionContext = _params.context;
		let diagnostics: Diagnostic[] = context.diagnostics;

		codeActions = await getCodeActions(diagnostics, textDocument, _params);

		return codeActions;
	}
)

async function getCodeActions(diagnostics: Diagnostic[], textDocument: TextDocument, params: CodeActionParams): Promise<CodeAction[]> {
	let codeActions: CodeAction[] = [];

	// Get quick fixes for each diagnostic
	for (let i = 0; i < diagnostics.length; i++) {

		let diagnostic = diagnostics[i];
		if (String(diagnostic.code).startsWith(DIAGNOSTIC_TYPE_COMPILE_ERROR)) {
			let labelPrefix: string = "Replace with ";
			let range: Range = diagnostic.range;
			let possibleReplacements: string = String(diagnostic.code).substring(DIAGNOSTIC_TYPE_COMPILE_ERROR.length);
			if (possibleReplacements.length != 0) {
				// Convert list of suggestions to an array
				// Example input: "a", "b", "c"
				var suggestionsArray = possibleReplacements.split(","); // split by commas
				for (var j = 0; j < suggestionsArray.length; j++) {
					suggestionsArray[j] = suggestionsArray[j].trim(); // trim whitespace
					if (suggestionsArray[j].startsWith("\"") && suggestionsArray[j].endsWith("\"")) {
						suggestionsArray[j] = suggestionsArray[j].substring(1, suggestionsArray[j].length - 1); // remove surrounding quotes
					}

					codeActions.push(getQuickFix(diagnostic, labelPrefix + suggestionsArray[j], range, suggestionsArray[j], textDocument));
				}
			}
		}
	}

	return codeActions;
}

function getQuickFix(diagnostic: Diagnostic, title: string, range: Range, replacement: string, textDocument: TextDocument): CodeAction {
	let textEdit: TextEdit = {
		range: range,
		newText: replacement
	};
	let workspaceEdit: WorkspaceEdit = {
		changes: { [textDocument.uri]: [textEdit] }
	}
	let codeAction: CodeAction = {
		title: title,
		kind: CodeActionKind.QuickFix,
		edit: workspaceEdit,
		diagnostics: [diagnostic]
	}
	return codeAction;
}


// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (_textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		// The passed parameter contains the position of the text document in
		// which code complete got requested.

		let completionItems: CompletionItem[] = [];

		// TODO parse snippets from a file instead of hardcoding
		{
			let sampleSnippet: string =
				"func main():\n"+
				"	[ap] = 1000; ap++\n"+
				"	[ap] = 2000; ap++\n"+
				"	[ap] = [ap - 2] + [ap - 1]; ap++\n"+
				"	ret\n"+
				"end";
			insertSnippet(_textDocumentPosition, sampleSnippet, completionItems, undefined, "Cairo template", 0);

			let pythonSnippet: string = 
				"%[ %]"
				insertSnippet(_textDocumentPosition, pythonSnippet, completionItems, undefined, "Python literal", 0);
		}

		return completionItems;
	}
);

function insertSnippet(_textDocumentPosition: TextDocumentPositionParams, snippetText: string, completionItems: CompletionItem[], imports: string | undefined, label: string, sortOrder: number) {
	let textEdit: TextEdit = {
		range: {
			start: _textDocumentPosition.position,
			end: _textDocumentPosition.position
		},
		newText: snippetText
	};
	let completionItem: CompletionItem = {
		label: label,
		kind: CompletionItemKind.Snippet,
		data: undefined,
		textEdit: textEdit,
		sortText: String(sortOrder)
	};
	// check if imports should be added
	let textDocument = documents.get(_textDocumentPosition.textDocument.uri)
	let textDocumentContents = textDocument?.getText()
	if (imports !== undefined && (textDocumentContents === undefined || !String(textDocumentContents).includes(imports))) {
		let additionalTextEdit = {
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 }
			},
			newText: imports
		};
		completionItem.additionalTextEdits = [additionalTextEdit]
	}

	completionItems.push(completionItem);
}

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	async (item: CompletionItem): Promise<CompletionItem> => {
		item.documentation = item.textEdit?.newText;
		return item;
	}
);

connection.onHover(

	async (_params: HoverParams): Promise<Hover> => {
		let textDocument = documents.get(_params.textDocument.uri)
		let position = _params.position
		let hover: Hover = {
			contents: ""
		}
		if (textDocument !== undefined) {
			var start = {
				line: position.line,
				character: 0,
			};
			var end = {
				line: position.line + 1,
				character: 0,
			};
			var text = textDocument.getText({ start, end });
			var index = textDocument.offsetAt(position) - textDocument.offsetAt(start);

			var word = getWord(text, index, true);
			if (isCairoKeyword(word)) {
				let buf = await getCairoKeywordMarkdown(word);
				hover.contents = buf;
				return hover;
			}

			var word = getWord(text, index, false);
			if (isCairoKeyword(word)) {
				let buf = await getCairoKeywordMarkdown(word);
				hover.contents = buf;
				return hover;
			}
		}
		return hover;
	}

);

function isCairoKeyword(word: string): boolean {
	var cairoKeywords = ['func'];
	for (var i = 0; i < cairoKeywords.length; i++) {
		if (word == cairoKeywords[i]) {
			return true;
		}
	}
	return false;
}

function getCairoKeywordMarkdown(word: string): string {
	// Populate by copying text from online documentation
	// then input to: https://euangoddard.github.io/clipboard2markdown/
	// then input to: https://www.freeformatter.com/javascript-escape.html
	var buf: string = "";
	if (word == 'func') {
		buf = "A\u00A0function is a reusable unit of code that receives arguments and returns a value. To facilitate this in Cairo, we introduce two low-level instructions:\u00A0`call\u00A0addr`, and\u00A0`ret`. In addition, the Cairo compiler supports high-level syntax for those instructions:\u00A0`foo(...)`\u00A0and\u00A0`return\u00A0(...)`\u00A0respectively.";
	}
	// format with title
	buf = "### " + word + "\n" + buf;
	return buf;
}

function getWord(text: string, index: number, includeDot: boolean) {
	var beginSubstring = text.substring(0, index);

	var endSubstring = text.substring(index, text.length);
	var boundaryRegex;
	if (includeDot) {
		boundaryRegex = /[^0-9a-zA-Z.]{1}/g; // boundaries are: not alphanumeric or dot
	} else {
		boundaryRegex = /[^0-9a-zA-Z]{1}/g; // boundaries are: not alphanumeric or dot
	}
	var first = lastIndexOfRegex(beginSubstring, boundaryRegex) + 1;
	var last = index + indexOfRegex(endSubstring, boundaryRegex);

	return text.substring(first !== -1 ? first : 0, last !== -1 ? last : text.length - 1);
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
