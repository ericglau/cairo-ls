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
	const nileUseVenv = workspace.getConfiguration().get('cairols.nileUseVenv') as boolean;
	const nileVenvCommand = workspace.getConfiguration().get('cairols.nileVenvCommand') as string;
	registerCommands(context, nileUseVenv, nileVenvCommand);

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

function registerCommands(context: ExtensionContext, nileUseVenv: boolean, nileVenvCommand: string) {
	var commandPrefix = "";
	if (nileUseVenv && nileVenvCommand != null && nileVenvCommand.length > 0) {
		commandPrefix = nileVenvCommand + " && ";
	}

	const compileCommand = commands.registerCommand('nile.compile', () => {
		terminal.show();
		var names = getActiveFileNames();
		terminal.sendText(commandPrefix + "nile compile '" + names.currentOpenFile + "'");
	});
	context.subscriptions.push(compileCommand);

	const compileAllCommand = commands.registerCommand('nile.compile.all', () => {
		terminal.show();
		terminal.sendText(commandPrefix + "nile compile");
	});
	context.subscriptions.push(compileAllCommand);

	const cleanCommand = commands.registerCommand('nile.clean', () => {
		terminal.show();
		terminal.sendText(commandPrefix + "nile clean");
	});
	context.subscriptions.push(cleanCommand);

	const runCommand = commands.registerCommand('pytest', () => {
		terminal.show();
		terminal.sendText(commandPrefix + "pytest");
	});
	context.subscriptions.push(runCommand);
}

function getActiveFileNames() {
	var currentOpenFile = window.activeTextEditor.document.fileName;
	return { currentOpenFile };
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
