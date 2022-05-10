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
	Position,
	LocationLink,
	Definition
} from 'vscode-languageserver';

import {
	TextDocument, Range, TextEdit
} from 'vscode-languageserver-textdocument';

// Import Cairo keywords
import { BASE_LVL_KEYWORDS, FUNC_LVL_KEYWORDS, BASE_STARKNET_KEYWORDS } from "./keywords"

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

let nonce: number = 0;
const CAIRO_TEMP_FILE_PREFIX = "temp";
const CAIRO_TEMP_FILE_SUFFIX = ".cairo";

const { exec } = require("child_process");

const { indexOfRegex, lastIndexOfRegex } = require('index-of-regex')

const fs = require('fs')
const os = require('os')
const path = require('path')
const uri2path = require('file-uri-to-path');
const url = require('url');
const glob = require('glob');

const defaultPackageLocation = os.homedir() + "/cairo_venv/lib/python3.7/site-packages";

let tempFolder: string;

let workspaceFolders: string[] = [];

let packageSearchPaths: string;

connection.onInitialize((params: InitializeParams) => {

	fs.mkdtemp(path.join(os.tmpdir(), 'cairo-ls-'), (err: string, folder: string) => {
		if (err) {
			connection.console.error(err);
			throw err;
		}
		tempFolder = folder;
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

	if (hasWorkspaceFolderCapability && params.workspaceFolders != null) {
		params.workspaceFolders.forEach(folder => {
			workspaceFolders.push(uri2path(folder.uri));
		});
		connection.console.log(`Workspace folders: ${workspaceFolders}`);
	}

	if (workspaceFolders.length == null && params.rootUri != null) {
		workspaceFolders.push(uri2path(params.rootUri));
	}

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
			},
			definitionProvider: true
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

async function getPythonLibraryLocation(uri: string): Promise<string> {
	// pip show cairo-lang | grep Location
	let textDocumentFromURI = documents.get(uri)
	if (textDocumentFromURI === undefined) {
		connection.console.log(`Could not read text document for uri ${uri}`);
		return defaultPackageLocation;
	}
	let settings = await getDocumentSettings(textDocumentFromURI.uri);

	const commandPrefix = getCommandPrefix(settings);

	try {
		const util = require('util');
		const exec = util.promisify(require('child_process').exec);
		const { stdout } = await exec(commandPrefix + "pip show cairo-lang | grep Location");
		const LOCATION_PREFIX = "Location: ";
		if (stdout.includes(LOCATION_PREFIX)) {
			const packageLocation = stdout.substring(LOCATION_PREFIX.length).trim();
			connection.console.log(`Package location: ${packageLocation}`);
			return packageLocation;
		} else {
			connection.console.log(`Could not parse cairo-lang package location from string '${stdout}', defaulting to: ${defaultPackageLocation}`);
			return defaultPackageLocation;
		}
	} catch (e) {
		connection.console.log(`Could not get cairo-lang package location from Python, defaulting to: ${defaultPackageLocation}. Error: ${e}`);
		return defaultPackageLocation;
	}

}

connection.onDefinition(async (params) => {
	await initPackageSearchPaths(params.textDocument.uri);

	// from contracts.Initializable import initialized, initialize

	// TODO: support this syntax:
	// from starkware.cairo.common.math import (
	//	assert_not_zero, assert_not_equal)

	/*

@external
func initialized{ storage_ptr: Storage*, pedersen_ptr: HashBuiltin*, range_check_ptr }() -> (res: felt):
    let (res) = _initialized.read()
    return (res=res)
end

@external
func initialize{ storage_ptr: Storage*, pedersen_ptr: HashBuiltin*, range_check_ptr }():
    let (initialized) = _initialized.read()
    assert initialized = 0
    _initialized.write(1)
    return ()
end

	*/

	connection.console.log(`Getting ready to import`);

	// TODO parse imports on document change and cache them

	// map of functions to the module it was imported from
	let imports : Map<string, string> = new Map();

	// parse imports
	let textDocumentFromURI = documents.get(params.textDocument.uri)
	let textDocumentContents = textDocumentFromURI?.getText()
	if (textDocumentContents === undefined) {
		connection.console.log(`Could not read text document contents`);
		return undefined;
	}
	// for each import, populate the map
	var lines = textDocumentContents.split('\n');
	var fromFound: boolean = false;
	let withinImportStatement: boolean = false;
	let withinImportModule: string | undefined;
	for (var i = 0; i < lines.length; i++) {
		var line: string = lines[i].trim();
		if (line.length == 0 || line.startsWith("#")) { // ignore whitespace or comments
			continue;
		}
		if (line.startsWith("from")) {
			fromFound = true;
			let tokens = line.split(/\s+/); // split by whitespace
			if (tokens.length < 4 || tokens[0] !== "from" || tokens[2] !== "import") {
				connection.console.log(`Could not parse import: ${line}`);
				return undefined;
			}
			for (let i = 3; i<tokens.length; i++) {
				let moduleName = tokens[1]
				let importName = tokens[i];
				if (importName.endsWith(',')) {
					importName = importName.substring(0, importName.length - 1);
				}
				if (importName == '(' || importName.includes('(')) {
					withinImportStatement = true;
					withinImportModule = moduleName;
					// continue to next line to get the imports
					continue;
				}
				imports.set(importName, moduleName);
				connection.console.log(`Added import to map: ${importName} from ${moduleName}`);
			}
		} else if (fromFound) {
			if (withinImportStatement && withinImportModule !== undefined) {
				// within a multiline import brackets section
				let tokens = line.split(/\s+/); // split by whitespace
				for (let importName of tokens) {
					if (importName.endsWith(',')) {
						importName = importName.substring(0, importName.length - 1);
					}
					if (importName !== ')') {
						imports.set(importName, withinImportModule);
						connection.console.log(`Added import to map from multiline: ${importName} from ${withinImportModule}`);	
					}
					if (line.includes(')')) {
						withinImportStatement = false;
					}
				}
				continue;
			} else {
				// end of imports
				break;
			}
		}
	}

	let links : LocationLink[] = [];

	let position = params.position
	if (textDocumentFromURI !== undefined) {
		let { wordWithDot, word } = getWordAtPosition(position, textDocumentFromURI);

		connection.console.log(`Imports map size: ${imports.size}`);

		for (const [importName, moduleName] of imports.entries()) {
			if (wordWithDot === moduleName) {
				connection.console.log(`Going to definition for module: ${moduleName}`);

				let { moduleUrl, modulePath } = getModuleURI(moduleName);
				if (moduleUrl === undefined || modulePath === undefined) {
					break;
				}

				let entireRange : Range = {
					start: { character : 0, line : 0 },
					end: { character : 0, line : 9999 }
				}
				let link : LocationLink = LocationLink.create(moduleUrl, entireRange, entireRange);
				links.push(link);
				break;
			} else if (wordWithDot.startsWith(importName)) {
				connection.console.log(`Going to definition for import: ${importName}`);

				let { moduleUrl, modulePath } = getModuleURI(moduleName);
				if (moduleUrl === undefined || modulePath === undefined) {
					break;
				}

				// Get function location
				let moduleContents : string = fs.readFileSync(modulePath, 'utf8');
				let lines = moduleContents.split('\n');
				let context: ParsingContext | undefined;
				for (var i = 0; i < lines.length; i++) {
					let line: string = lines[i].trim();
					if (line.length == 0 || line.startsWith("#")) { // ignore whitespace or comments
						continue;
					}
					if (context !== undefined && context.namespace !== undefined) {
						// find out when the namespace ends
						if (startsWith(line, 'func')) {
							context.inFunc = true;
						} else if (startsWith(line, 'with_attr')) {
							context.inAttr = true;
						} else if (context.inAttr && line === 'end') {
							context.inAttr = false;
							continue;
						} else if (context.inFunc && line === 'end') {
							context.inFunc = false;
							continue;
						} else if (!context.inAttr && !context.inFunc && line === 'end') {
							context.namespace = undefined;
							continue;
						}
					}

					const FUNC = "func";
					const STRUCT = "struct";
					const NAMESPACE = "namespace";

					if (startsWith(line, 'func')) {
						if (context !== undefined && context.namespace !== undefined) {
							const [ namespace, func ] = wordWithDot.split('.');
							// if we are hovering over the function portion in namespace.function, add the function definition from the imported module
							if (namespace === context.namespace && word === func) {
								connection.console.log(`pushing ${namespace} ${func}`);
								pushDefinitionIfFound(line, func, moduleUrl, "{", "namespace-function", namespace);
								pushDefinitionIfFound(line, func, moduleUrl, "(", "namespace-function", namespace);
							}
						} else {
							pushDefinitionIfFound(line, importName, moduleUrl, "{", FUNC);
							pushDefinitionIfFound(line, importName, moduleUrl, "(", FUNC);
						}
					}

					if (startsWith(line, 'struct')) {
						pushDefinitionIfFound(line, importName, moduleUrl, ":", STRUCT);
					}

					if (startsWith(line, 'namespace')) {
						// get namespace from line
						const searchNamespace = line.substring('namespace'.length, line.lastIndexOf(':')).trim();
						context = { namespace: searchNamespace };
						connection.console.log(`Going into namespace: ${context.namespace}`);
	
						const [ namespace ] = wordWithDot.split('.');
						// if we are hovering over the namespace portion in namespace.function, add the namespace definition from the imported module
						if (word === namespace) {
							pushDefinitionIfFound(line, importName, moduleUrl, ":", NAMESPACE);
						}
					}
				}
			}
		}

		// Get function location
		let lines = textDocumentContents.split('\n');
		for (var i = 0; i < lines.length; i++) {
			let line: string = lines[i].trim();
			if (line.length == 0 || line.startsWith("#")) { // ignore whitespace or comments
				continue;
			}
			if (line.startsWith("func") && line.length > 5 && line.charAt(4).match(/\s/)) { // look for functions
				let lineTrim = line.substring(5, line.length).trim();
				let functionNameStartIndex = 0;
				let functionNameEndIndex = lineTrim.indexOf('{');
				if (functionNameEndIndex > functionNameStartIndex && lineTrim.substring(functionNameStartIndex, functionNameEndIndex).trim() === wordWithDot) {
					connection.console.log(`Found function within the same module: ${line}`);
					let functionLineRange : Range = {
						start: { character : 0, line : i },
						end: { character : 999, line : i }
					}
					let link : LocationLink = LocationLink.create(params.textDocument.uri, functionLineRange, functionLineRange);
					links.push(link);
				}
			}
		}
		return links;
	}

	interface ParsingContext {
		inAttr?: boolean;
		inFunc?: boolean;
		namespace?: string;
	}

	function pushDefinitionIfFound(line: string, importName: string, moduleUrl: any, endOfNameDelimiter: string, type: DefinitionType, inNamespace?: string) {
		if (inNamespace !== undefined && type !== 'namespace-function') {
			connection.console.log(`ERROR: pushDefinitionIfFound is not adding a namespace function but a namespace string was provided`);
		}		

		let importNameStartIndex = line.indexOf(importName);
		let importNameEndIndex = line.indexOf(endOfNameDelimiter);
		if (importNameStartIndex >= 0 && importNameEndIndex > importNameStartIndex 
				&& /\s+/.test(line.charAt(importNameStartIndex - 1))
				&& line.substring(importNameStartIndex, importNameEndIndex).trim() === importName) {
			connection.console.log(`Found function or struct: ${line} with line number ${i}`);
			let functionLineRange: Range = {
				start: { character: 0, line: i },
				end: { character: 999, line: i }
			};
			let link: LocationLink = LocationLink.create(moduleUrl, functionLineRange, functionLineRange);
			links.push(link);
		}
	}
});

type DefinitionType = 'func' | 'struct' | 'namespace' | 'namespace-function';

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
	highlightingCompiler: string;
	maxNumberOfProblems: number;
	useVenv: boolean;
	venvCommand: string;
	nileUseVenv: boolean;
	nileVenvCommand: string;
	sourceDir?: string;
}

const DEFAULT_HIGHLIGHTING_COMPILER = "autodetect";
const DEFAULT_MAX_PROBLEMS = 100;
const DEFAULT_USE_VENV = true;
const DEFAULT_VENV_COMMAND = ". ~/cairo_venv/bin/activate";
const DEFAULT_NILE_USE_VENV = true;
const DEFAULT_NILE_VENV_COMMAND = ". env/bin/activate";

let defaultSettings: CairoLSSettings = { highlightingCompiler: DEFAULT_HIGHLIGHTING_COMPILER, maxNumberOfProblems: DEFAULT_MAX_PROBLEMS, useVenv: DEFAULT_USE_VENV, venvCommand: DEFAULT_VENV_COMMAND, nileUseVenv: DEFAULT_NILE_USE_VENV, nileVenvCommand: DEFAULT_NILE_VENV_COMMAND, sourceDir: undefined };
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

enum ImportType {
	Module,
	ImportKeyword,
	Function
}

function startsWith(line: string, prefix: string) {
	return line.startsWith(prefix) && line.length > prefix.length + 1 && line.charAt(prefix.length).match(/\s/);
}

function getImportAroundPosition(position: Position, textDocumentFromURI: TextDocument, ) {
	let startOfLine = {
		line: position.line,
		character: 0,
	};
	let cursurPosition = {
		line: position.line,
		character: position.character,
	};
	let nextLine = {
		line: position.line + 1,
		character: 0,
	}
		
	let lineUpToCursor = textDocumentFromURI.getText({ start: startOfLine, end: cursurPosition });
	let lineUpToCursorSplit = lineUpToCursor.split(/\s+/);
	if (lineUpToCursorSplit !== undefined && lineUpToCursorSplit[0] !== undefined && lineUpToCursorSplit[0] === 'from') {
		let textBeforeCursor = lineUpToCursorSplit[lineUpToCursorSplit.length - 1];
		let textAfterCursor = textDocumentFromURI.getText({ start: cursurPosition, end: nextLine })?.split(/\s+/)[0];
		connection.console.log(`found import text before cursor: ${textBeforeCursor}, after cursor: ${textAfterCursor}`);
		let importType: ImportType;
		if (lineUpToCursorSplit.length == 2) {
			// handling the module e.g. "from module"
			importType = ImportType.Module;
		} else if (lineUpToCursorSplit.length == 3) {
			// handling the import keyword e.g. "from module import"
			importType = ImportType.ImportKeyword;
		} else if (lineUpToCursorSplit.length >= 4) {
			// handling the imported function e.g. "from module import func"
			importType = ImportType.Function;
		} else {
			// otherwise give uup
			connection.console.log(`not sure how to help with import`);
			return undefined;
		}
		return { importType, textBeforeCursor, textAfterCursor };
	} else {
		connection.console.log(`not an import`);
		return undefined;
	}
}

function getWordAtPosition(position: Position, textDocumentFromURI: TextDocument, cutoffAtPosition?: boolean) {
	let start = {
		line: position.line,
		character: 0,
	};
	let end = cutoffAtPosition ? 
		{
			// right after actual cursor
			line: position.line,
			character: position.character + 1,
		}
		:
		{
			// next line
			line: position.line + 1,
			character: 0,
		};
	let text = textDocumentFromURI.getText({ start, end });
	let index = textDocumentFromURI.offsetAt(cutoffAtPosition? end : position) - textDocumentFromURI.offsetAt(start);
	let wordWithDot = getWord(text, index, true);
	connection.console.log(`Current word with dot: ${wordWithDot}`);
	let word = getWord(text, index, false);
	connection.console.log(`Current word: ${word}`);
	return { wordWithDot, word };
}

function getModuleURI(moduleName: string) {
	let moduleRelativePath = moduleName.split('.').join('/') + ".cairo";
	let moduleUrl = undefined;
	let modulePath = undefined;

	if (packageSearchPaths != null && packageSearchPaths.length > 0) {
		// TODO get modules relative to folders in actual CAIRO_PATH as well
		
		for (let element of packageSearchPaths.split(';')) {
			let possibleModulePath = path.join(element, moduleRelativePath);
			connection.console.log(`Possible module path: ${possibleModulePath}`);

			if (fs.existsSync(possibleModulePath)) {
				connection.console.log(`Module exists: ${possibleModulePath}`);
				moduleUrl = url.pathToFileURL(possibleModulePath);
				modulePath = possibleModulePath;
				connection.console.log(`Module URL: ${moduleUrl}`);
				break;
			}
		}
	}
	return { moduleUrl, modulePath };
}

async function getDocumentSettings(resource: string): Promise<CairoLSSettings> {
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
	const awaited = await result;
	if (awaited == null) {
		return Promise.resolve(globalSettings);
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

interface TempFiles {
	sourcePath: string;
	outputName: string;
	outputPath: string;
	compileNonce: number;
}

function getNextTempFiles(): TempFiles {
	const sourcePath = path.join(tempFolder, CAIRO_TEMP_FILE_PREFIX + nonce + CAIRO_TEMP_FILE_SUFFIX);
	const outputName = "temp_compiled" + nonce + ".json";
	const outputPath = path.join(tempFolder, outputName);
	const compileNonce = nonce++;
	return { sourcePath, outputName, outputPath, compileNonce };
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {

	let textDocumentFromURI = documents.get(textDocument.uri)
	let textDocumentContents = textDocumentFromURI?.getText()

	// In this simple example we get the settings for every validate run.
	let settings = await getDocumentSettings(textDocument.uri);

	let diagnostics: Diagnostic[] = [];

	// Compile temp file instead of this current file
	const tempFiles = getNextTempFiles();
	fs.writeFile(tempFiles.sourcePath, textDocumentContents, function (err: any) {
		if (err) {
			connection.console.error(`Failed to write temp source file: ${err}`);
			return;
		}
		connection.console.log(`Temp source file ${tempFiles.sourcePath} saved!`);
	});

	var commandPrefix = getCommandPrefix(settings);

	await exec(commandPrefix + "cd " + tempFolder + " && " + getCompileCommand(settings, tempFiles, textDocumentContents), (error: { message: any; }, stdout: any, stderr: any) => {
		// delete temp files
		deleteTempFile(tempFiles.sourcePath);
		deleteTempFile(tempFiles.outputPath);

		// if the result was from an old nonce, ignore it
		if (nonce > tempFiles.compileNonce + 1) {
			connection.console.log('got result from compile nonce ' + tempFiles.compileNonce + ' but current nonce is ' + nonce);
			return;
		}

		if (error) {
			connection.console.log(`Found compile error: ${error.message}`);
			let errorLocations: ErrorLocation[] = findErrorLocations(error.message);
			let problems = 0;
			for (var i = 0; i < errorLocations.length; i++) {
				let element: ErrorLocation = errorLocations[i];
				let maxProblems = settings?.maxNumberOfProblems || DEFAULT_MAX_PROBLEMS;
				if (problems < maxProblems) {
					problems++;

					addDiagnostic(element, `${element.errorMessage}`, 'Cairo compilation encountered an error.', DiagnosticSeverity.Error, DIAGNOSTIC_TYPE_COMPILE_ERROR + (element.suggestions != undefined ? element.suggestions : ""));
				}
			}
		}
		connection.console.log(`Cairo compiler output: ${stdout}`);

		// Send the computed diagnostics to VSCode.
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });	
	});

	function deleteTempFile(path: string) {
		fs.unlink(path, (e: any) => {
			if (e) {
				connection.console.log(`Could not delete temp file ${path}: ${e}`);
			}
		});
	}

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
	}
}

/**
 * Gets the command prefix include source command if any.
 */
function getCommandPrefix(settings: CairoLSSettings) {
	var commandPrefix = "";
	if (settings.nileUseVenv && settings.nileVenvCommand != null && settings.nileVenvCommand.length > 0) {
		const child_process = require('child_process');
		try {
			child_process.execSync(settings.nileVenvCommand);
			// if it passes, then nile venv exists
			commandPrefix = settings.nileVenvCommand + " && ";
		} catch (error) {
			connection.console.log(`Could not source nile venv. Error: ${error}`);
		}
	}
	// if nile venv not used or not found, look for a cairo venv
	if (commandPrefix === "" && settings.useVenv && settings.venvCommand != null && settings.venvCommand.length > 0) {
		commandPrefix = settings.venvCommand + " && ";
	}
	return commandPrefix;
}

function appendSourceDir(basePath: string, sourceDir?: string) {
	const append = sourceDir || getPythonPackageDir(basePath);
	if (append !== undefined && append.length > 0) {
		return path.join(basePath, append);
	} else {
		return basePath;
	}
}

function getPythonPackageDir(basePath: string) {
	const setupFile = path.join(basePath, 'setup.cfg');
	try {
		let contents : string = fs.readFileSync(setupFile, 'utf8');
		let lines = contents.split('\n');
		let inOptionsPackagesFind: boolean = false;
		for (var i = 0; i < lines.length; i++) {
			let line: string = lines[i].trim();
			if (line.length == 0) {
				if (inOptionsPackagesFind) {
					connection.console.log(`No source directory in Python config`);
					break;
				} else {
					continue;
				}
			} else if (line.startsWith("#")) {
				continue;
			}
			if (line === '[options.packages.find]') {
				inOptionsPackagesFind = true;
				continue;
			}
			if (inOptionsPackagesFind && line.startsWith('where')) {
				const split = line.split(/\s+/);
				if (split.length === 3) {
					connection.console.log(`Using source directory ${split[2]} from Python config file ${setupFile}`);
					return split[2];
				} else {
					connection.console.log(`ERROR: Failed to parse source directory from Python config`);
				}
			}
		}
	} catch (e) {
		connection.console.log(`Could not read Python config from ${setupFile}: ` + e);
	}
}

/**
 * Gets the compile command (using Cairo or StarkNet compiler).
 * If highlighing compiler setting is set to autodetect, this is based on whether "%lang starknet" is defined in the directives.
 * 
 * @param settings Cairo LS settings
 * @param textDocumentContents The current document contents.
 * @returns The Cairo or StarkNet compile command.
 */
function getCompileCommand(settings: CairoLSSettings, tempFiles: TempFiles, textDocumentContents?: string): string {
	let cairoPathParam = "";

	const sourceDir = settings.sourceDir;

	if (workspaceFolders.length > 0) {
		cairoPathParam = '--cairo_path=';
		for (i = 0; i < workspaceFolders.length; i++) {
			cairoPathParam += appendSourceDir(workspaceFolders[i], sourceDir);
			if (i < workspaceFolders.length - 1) {
				cairoPathParam += ':';
			}
		}
		cairoPathParam += ' ';
	}
	const CAIRO_COMPILE_COMMAND = "cairo-compile " + cairoPathParam + tempFiles.sourcePath + " --output " + tempFiles.outputName;
	const STARKNET_COMPILE_COMMAND = "starknet-compile " + cairoPathParam + tempFiles.sourcePath + " --output " + tempFiles.outputName;

	var compiler = settings.highlightingCompiler;
	if (compiler === "starknet") {
		return STARKNET_COMPILE_COMMAND;
	} else if (compiler === "cairo") {
		return CAIRO_COMPILE_COMMAND;
	} else {
		// Auto-detect which compiler to use
		if (textDocumentContents === undefined) {
			connection.console.log(`Could not read text document contents`);
			return CAIRO_COMPILE_COMMAND;
		}
		// for each directive, see if it uses StarkNet lang
		var lines = textDocumentContents.split('\n');
		var directivesFound: boolean = false;
		for (var i = 0; i < lines.length; i++) {
			var line: string = lines[i].trim();
			if (line.length == 0 || line.startsWith("#")) { // ignore whitespace or comments
				continue;
			}
			if (line.startsWith("%")) {
				directivesFound = true;
				if (line === "%lang starknet") {
					connection.console.log(`Running StarkNet compile`);
					return STARKNET_COMPILE_COMMAND;
				}
			} else if (directivesFound) {
				// end of directives
				break;
			}
		}
		connection.console.log(`Running Cairo compile`);
		return CAIRO_COMPILE_COMMAND;
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

enum SyntaxType {
	ImportModule,     // from
	ImportKeyword,    // from <moduleName>
	ImportFunction,   // from <moduleName> import
	ImportFunctionP,  // from <moduleName> import ( ... )	
	FunctionDecl,     // between "func" and ":"
	Function,         // between ":" and "end"
	WithAttr,		  // with_attr
	Base              // file level
}

// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (textDocPositionParams: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		await initPackageSearchPaths(textDocPositionParams.textDocument.uri);

		const completionItems: CompletionItem[] = [];

		const textDocumentFromURI = documents.get(textDocPositionParams.textDocument.uri);
		// Recommandations change depending on the highlightingCompiler
		const { highlightingCompiler } = await getDocumentSettings(textDocPositionParams.textDocument.uri);

		let compiler = highlightingCompiler;
		if (compiler == "autodetect") {
			// If highlighting compiler is autodetect, read the first line of the file and check if it
			// is %lang starknet
			compiler = textDocumentFromURI?.getText({
				start: { character: 0, line: 0 },
				end: { character: 0, line: 1 }
			}).startsWith("%lang starknet")
				? "starknet"
				: "cairo";
		}

		// If couldn't fetch the text, return empty list
		if (textDocumentFromURI == null)
			return completionItems;

		const position = textDocPositionParams.position;
		const syntaxType = getSyntaxType(position, textDocumentFromURI);

		switch (syntaxType) {
			case SyntaxType.Base:
				return compiler == "starknet"
					? [...BASE_LVL_KEYWORDS, ...BASE_STARKNET_KEYWORDS]
					: BASE_LVL_KEYWORDS;

			case SyntaxType.Function:
				return FUNC_LVL_KEYWORDS;

			case SyntaxType.ImportModule: {
				const textAroundCursor = getTextAroundCursor(position, textDocumentFromURI);
				if (textAroundCursor == undefined)
					return completionItems;
				const { textBeforeCursor, textAfterCursor } = textAroundCursor;

				const packages = await getAllCairoFilesStartingWith(
					textDocPositionParams.textDocument.uri, textBeforeCursor);

				for (const packageString of packages) {
					completionItems.push(getNewCompletionItem(textDocPositionParams, packageString, packageString, 0, textBeforeCursor, textAfterCursor));
				}
				return completionItems;
			}

			case SyntaxType.ImportKeyword: {
				const textAroundCursor = getTextAroundCursor(position, textDocumentFromURI);
				if (textAroundCursor == undefined)
					return completionItems;
				const { textBeforeCursor, textAfterCursor } = textAroundCursor;

				completionItems.push(getNewCompletionItem(textDocPositionParams, "import", "import", 0, textBeforeCursor, textAfterCursor));
				return completionItems;
			}

			case SyntaxType.FunctionDecl: {
				return [];
			}

			case SyntaxType.WithAttr: {
				return [];
			}

			case SyntaxType.ImportFunction: {
				const textAroundCursor = getTextAroundCursor(position, textDocumentFromURI);
				if (textAroundCursor == undefined)
					return completionItems;
				const { textBeforeCursor, textAfterCursor } = textAroundCursor;

				await initPackageSearchPaths(textDocPositionParams.textDocument.uri);

				let moduleName = getModuleNameFromImportPosition(textDocPositionParams, textDocumentFromURI);
				const importItems = getModuleFunctions(moduleName);
				for (let i of importItems) {
					completionItems.push(getNewCompletionItem(textDocPositionParams, i, i, 0, textBeforeCursor, textAfterCursor));
				}
				return completionItems;
			}

			case SyntaxType.ImportFunctionP: {
				// Since there are multiple lines involved, the way we'll get the module name will differ
				const fileStart = { line: 0, character: 0 };
				const cursorPosition = { line: position.line, character: position.character };

				// Match the text until cursor to the regex, afterwards get the 1st group
				const importFunctionRegex = /^from[ \t]+([a-zA-Z0-9._]+)[ \t]+import[ \t]*\((?![\s\S]*\))/m
				const textUpToCursor = textDocumentFromURI.getText({ start: fileStart, end: cursorPosition });

				const moduleName = textUpToCursor.match(importFunctionRegex)?.[1];
				if (moduleName == undefined) {
					connection.console.log("Couldn't find moduleName, got " + moduleName);
					return completionItems;
				}

				const importItems = getModuleFunctions(moduleName);
				for (const item of importItems) {
					// Since I match the module name by reading from top of the file, it'd be harder to find
					// start and end indices of each occurence. Default values of CompletionItem should be 
					// enough anyways
					completionItems.push({
						label: item,
						kind: CompletionItemKind.Module,
						sortText: String(0)
					});
				}
				return completionItems;
			}
		}

	}
);

/**
 * @summary Gets text before and after the cursor ( on the same line )
 * @param position 
 * @param textDocumentFromURI 
 * @returns Text before and after the cursor position | undefined
 */
 function getTextAroundCursor(position: Position, textDocumentFromURI: TextDocument) {
	const startOfLine = {
		line: position.line,
		character: 0
	};
	const cursorPosition = {
		line: position.line,
		character: position.character
	};
	const nextLine = {
		line: position.line + 1,
		character: 0,
	};

	const lineUpToCursor = textDocumentFromURI.getText({ start: startOfLine, end: cursorPosition });
	const lineUpToCursorSplit = lineUpToCursor.split(/\s+/);
	if (lineUpToCursorSplit?.[0] === undefined)
		return undefined

	const textBeforeCursor = lineUpToCursorSplit[lineUpToCursorSplit.length - 1];

	const textAfterCursor = textDocumentFromURI
		.getText({ start: cursorPosition, end: nextLine })?.split(/\s+/)[0];

	return { textBeforeCursor, textAfterCursor };
}

/**
 * @summary Infers the type of the syntax the cursor is pointing at
 * @param position 
 * @param textDocumentFromURI 
 * @returns SyntaxType of the current location
 */
 function getSyntaxType(position: Position, textDocumentFromURI: TextDocument): SyntaxType {
	const fileStart = { line: 0, character: 0 };
	const lineStart = { line: position.line, character: 0 };
	const cursorPosition = { line: position.line, character: position.character };

	// Get text from the start of the document to position of the cursor
	// This might be too exhaustive on a large file, should change if there's a better way to 
	// determine if we're inside a function/from statement etc.
	const textUpToCursor = textDocumentFromURI.getText({ start: fileStart, end: cursorPosition });
	const textOnLine = textDocumentFromURI.getText({ start: lineStart, end: cursorPosition });

	// Line based checks
	// from
	if (textOnLine.trimLeft().trimRight() === "from")
		return SyntaxType.ImportModule;

	// from module
	if (textOnLine.trimLeft().startsWith("from") && !textOnLine.includes("import"))
		return SyntaxType.ImportKeyword;

	// from module import
	if (textOnLine.trimLeft().startsWith("from") && textOnLine.includes("import"))
		return SyntaxType.ImportFunction;


	// Now that we don't have a one-line syntax, we'll check for scopes. This means we'll iterate
	// over the file line by one and see where in the syntax we end up with
	// Note that this is a long way to check where we are in file. Should be replaced with a faster 
	// method if there is any
	const reducedType = textUpToCursor.split('\n').reduce((lastType, line) => {
		if (line.trimLeft().trimRight() == "end") {
			if(lastType === SyntaxType.WithAttr)
				return SyntaxType.Function;
			else
				return SyntaxType.Base;
		}

		// Capture with_attr
		if (line.trimLeft().startsWith("with_attr")) {
			return SyntaxType.WithAttr;
		}

		// Capture function declaration
		if (line.trimLeft().startsWith("func") && !line.includes(":")) {
			return SyntaxType.FunctionDecl;
		}

		// Capture function body
		if (lastType === SyntaxType.FunctionDecl && line.trimRight().endsWith(":")) {
			return SyntaxType.Function;
		}

		// Capture import with parentheses
		if (line.trimLeft().startsWith("from") && line.includes("(")) {
			return SyntaxType.ImportFunctionP;
		}

		// Capture closing parentheses of import
		if (lastType === SyntaxType.ImportFunctionP && line.includes(")")) {
			return SyntaxType.Base;
		}

		return lastType;
	}, SyntaxType.Base)

	return reducedType;
}

function getModuleNameFromImportPosition(textDocPositionParams: TextDocumentPositionParams, textDocumentFromURI: TextDocument) {
	let startOfLine = {
		line: textDocPositionParams.position.line,
		character: 0,
	};
	let cursurPosition = {
		line: textDocPositionParams.position.line,
		character: textDocPositionParams.position.character,
	};
	let lineUpToCursor = textDocumentFromURI.getText({ start: startOfLine, end: cursurPosition });
	let moduleName = lineUpToCursor.split(/\s+/)[1];
	connection.console.log(`Module: ${moduleName}`);
	return moduleName;
}

/**
 * @summary Reads a module and extracts a set of its functions
 * @param moduleName 
 * @returns Set of functions of the module 
 */
 function getModuleFunctions(moduleName: string): Set<string> {
	console.log(moduleName)
	const { modulePath } = getModuleURI(moduleName);
	console.log(modulePath);

	// Get function location from the module
	let moduleContents: string = fs.readFileSync(modulePath, 'utf8');
	let lines = moduleContents.split('\n');
	let importItems: Set<string> = new Set<string>(); // keep a set of unique entries
	for (var i = 0; i < lines.length; i++) {
		let line: string = lines[i].trim();
		if (line.length == 0 || line.startsWith("#")) { // ignore whitespace or comments
			continue;
		}
		const FUNC = "func";
		const STRUCT = "struct";
		const NAMESPACE = "namespace";
		const isFunction = line.startsWith(FUNC) && line.length > FUNC.length + 1 && line.charAt(FUNC.length).match(/\s/);
		const isStruct = line.startsWith(STRUCT) && line.length > STRUCT.length + 1 && line.charAt(STRUCT.length).match(/\s/);
		const isNamespace = line.startsWith(NAMESPACE) && line.length > NAMESPACE.length + 1 && line.charAt(NAMESPACE.length).match(/\s/);
		if (isFunction || isStruct || isNamespace) {
			let importItem = line.split(/[\s{(:]+/)[1];
			importItems.add(importItem);
		}
	}

	return importItems;
}

function isFolder(dirPath: string) {
	return fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
}

/**
 * Get all packages with given prefix
 * @param uri uri of the text document
 * @param prefix package path prefix
 * @returns string array
 */
async function getAllCairoFilesStartingWith(uri: string, prefix: string) : Promise<string[]> {
	await initPackageSearchPaths(uri);
	
	let result: string[] = [];
	
	// TODO get modules relative to folders in actual CAIRO_PATH as well
	let packageSearchPathsArray = packageSearchPaths.split(';');

	for (let searchPath of packageSearchPathsArray) {

		connection.console.log(`For search path: ${searchPath}`);

		const lastDotIndex = prefix.lastIndexOf('.');
		const parentFolderOfPrefix = prefix.substring(0, lastDotIndex);
		const parentFolderAsPath = parentFolderOfPrefix.split('.').join('/');

		let possibleImportFolder = path.join(searchPath, parentFolderAsPath);
		connection.console.log(`Possible import folder: ${possibleImportFolder}`);

		let cairoFileAbsPaths: string[] = glob.sync(possibleImportFolder + "/**/*.cairo");

		// convert absolute paths to import style paths
		for (let fileFullPath of cairoFileAbsPaths) {
			const withoutFileExtension = fileFullPath.substring(0, fileFullPath.lastIndexOf(".cairo"));
			const relativePathWithoutExt = relativize(withoutFileExtension, searchPath);

			if (isPartOfAnotherSearchPath(fileFullPath, searchPath, packageSearchPathsArray)) {
			 	connection.console.log(`Skipping path since it is part of another search path: ${relativePathWithoutExt}`);
			} else if (relativePathWithoutExt.includes('.')) {
				// filter out paths that have "." since those are not proper cairo paths
				// e.g. "cairo-contracts/env/lib/python3.9/site-packages/starkware/cairo/common/bitwise" is part of a venv, not really a contract path in the current search path
				connection.console.log(`Skipping path since it's not a valid cairo path: ${relativePathWithoutExt}`);
			} else if (fileFullPath.includes('site-packages/nile/base_project')) {
				connection.console.log(`Skipping nile base project: ${relativePathWithoutExt}`);
			} else {
				connection.console.log(`Adding package path for cairo file: ${relativePathWithoutExt}`);
				result.push(convertPathToImport(relativePathWithoutExt));	
			}
		}
	}
	
	connection.console.log(`Found ${result.length} cairo files:`);

	return result;
}

function isPartOfAnotherSearchPath(filePath: string, searchPath: string, packageSearchPaths: string[]) {
	for (let otherSearchPath of packageSearchPaths) {
		if (otherSearchPath !== searchPath && otherSearchPath.startsWith(searchPath) && filePath.startsWith(otherSearchPath)) {
			return true;
		}
	}
	false;
}

function relativize(fileFullPath: any, relativeParent: string): string {
	return fileFullPath.substring(relativeParent.length + 1);
}

function convertPathToImport(relativePath: any): string {
	return relativePath.split('/').join('.');
}

async function initPackageSearchPaths(uri: string) {
	if (packageSearchPaths === undefined) {
		const packageLocation = await getPythonLibraryLocation(uri);

		const settings = await getDocumentSettings(uri);
		const sourceDir = settings.sourceDir;

		packageSearchPaths = '';
		for (let i = 0; i < workspaceFolders.length; i++) {
			packageSearchPaths += appendSourceDir(workspaceFolders[i], sourceDir) + ';';
		}

		packageSearchPaths += packageLocation;
		connection.console.log(`Package search paths: ${packageSearchPaths}`);
	}
}

function getNewCompletionItem(_textDocumentPosition: TextDocumentPositionParams, newText: string, label: string, sortOrder: number, existingTextBeforeCursor: string, existingTextAfterCursor: string) {
	let replaceStart: Position = Position.create(_textDocumentPosition.position.line, _textDocumentPosition.position.character - existingTextBeforeCursor.length);
	let replaceEnd: Position = Position.create(_textDocumentPosition.position.line, _textDocumentPosition.position.character + existingTextAfterCursor.length);
	let textEdit: TextEdit = {
		range: {
			start: replaceStart,
			end: replaceEnd
		},
		newText: newText
	};
	let completionItem: CompletionItem = {
		label: label,
		kind: CompletionItemKind.Module,
		data: undefined,
		textEdit: textEdit,
		sortText: String(sortOrder)
	};
	return completionItem;
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
		boundaryRegex = /[^0-9a-zA-Z_.]{1}/g; // boundaries are: not alphanumeric or _ or dot
	} else {
		boundaryRegex = /[^0-9a-zA-Z_]{1}/g; // boundaries are: not alphanumeric or _
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
