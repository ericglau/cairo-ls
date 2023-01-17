# Cairo Language Server

[![VS Code](https://img.shields.io/visual-studio-marketplace/i/ericglau.cairo-ls?label=VS%20Code)](https://marketplace.visualstudio.com/items?itemName=ericglau.cairo-ls) [![vim/nvim](https://img.shields.io/npm/dt/coc-cairo?label=vim%2Fnvim)](https://github.com/kevinhalliday/coc-cairo) [![LSP](https://img.shields.io/npm/dt/cairo-ls?label=LSP)](https://www.npmjs.com/package/cairo-ls) 

Code assistance for writing [Cairo](https://www.cairo-lang.org/) smart contracts for StarkNet.

Works with any IDE or text editor that supports the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

**Note**: This is an early preview release and is still in active development.

![](images/codecomplete.gif)

## Features

- Compiler support for .cairo files
- Live diagnostic highlighting for compile errors
- Quick fixes with suggestions provided by Cairo/StarkNet compiler
- Go to definitions for imports
- Code completion for imports

## IDE support

- Prerequisites:
  - Install [node](https://nodejs.org/en/) on your local machine.

### VS Code

[**VS Code extension**](https://marketplace.visualstudio.com/items?itemName=ericglau.cairo-ls)

### Vim

[**CoC extension**](https://github.com/kevinhalliday/coc-cairo) with [setup instructions](https://github.com/ericglau/cairo-ls/blob/main/VIM.md).

### Helix

[**Helix setup instructions**](HELIX.md)

### How to use with other IDEs

[**Language server**](https://www.npmjs.com/package/cairo-ls)

1. In an empty directory, run the following to install the language server:
```
npm install cairo-ls
```
2. Configure a language client for your IDE to launch the language server with the following command (replace `YOUR_DIRECTORY` with the directory where you ran the command in step 1):
```
node YOUR_DIRECTORY/cairo-ls/node_modules/cairo-ls/out/server.js --stdio
```
3. Install Nile by following its [Getting started](https://github.com/OpenZeppelin/nile#getting-started) steps, or follow the [Cairo environment setup steps](https://www.cairo-lang.org/docs/quickstart.html).
4. Open a .cairo file in your IDE or text editor.
5. If your project's contracts directory is in a subfolder such as `src`, set the folder name using the `sourceDir` setting in your IDE or language client settings.
