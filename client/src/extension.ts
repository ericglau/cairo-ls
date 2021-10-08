/* --------------------------------------------------------------------------------------------
 * Copyright for portions from https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample 
 * are held by (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * 
 * Copyright (c) 2021 Eric Lau. All rights reserved. 
 * Licensed under the Eclipse Public License v2.0
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { workspace, ExtensionContext, commands, window } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

let client: LanguageClient;

var terminal;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};
	
	terminal = window.createTerminal({ name: "Cairo LS" });
	registerCommands(context);

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for Cairo .cairo documents
		documentSelector: [
			{
			  pattern: '**/*.cairo',
			  scheme: 'file'
			}
		],
		synchronize: {
			// Notify the server about file changes to '.cairo files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/*.cairo')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'cairols',
		'Cairo LS',
		serverOptions,
		clientOptions
	);
	
	// Start the client. This will also launch the server
	client.start();
}

function registerCommands(context: ExtensionContext) {
	const compileCommand = commands.registerCommand('cairo.compile', () => {
		terminal.show();
		var { currentOpenFile, outputFile } = getActiveFileNames();
		terminal.sendText("cairo-compile '" + currentOpenFile + "' --output '" + outputFile + "'");
	});
	context.subscriptions.push(compileCommand);

	const runCommand = commands.registerCommand('cairo.run', () => {
		terminal.show();
		var { currentOpenFile, outputFile } = getActiveFileNames();
		terminal.sendText("cairo-run --program='" + outputFile + "' --print_output --print_info --relocate_prints");
	});
	context.subscriptions.push(runCommand);

	const runLayoutSmallCommand = commands.registerCommand('cairo.run.layout.small', () => {
		terminal.show();
		var { currentOpenFile, outputFile } = getActiveFileNames();
		terminal.sendText("cairo-run --program='" + outputFile + "' --print_output --print_info --relocate_prints --layout=small");
	});
	context.subscriptions.push(runLayoutSmallCommand);
}

function getActiveFileNames() {
	var currentOpenFile = window.activeTextEditor.document.fileName;
	var outputFile = currentOpenFile.substring(0, currentOpenFile.lastIndexOf(".")) + "_compiled.json";
	return { currentOpenFile, outputFile };
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
