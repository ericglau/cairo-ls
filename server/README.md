# Cairo Language Server

Code assistance for writing [Cairo](https://www.cairo-lang.org/) smart contracts for StarkNet.

Works with any IDE or text editor that supports the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

**Note**: This is an early preview release and is still in active development.

https://www.npmjs.com/package/cairo-ls

![](images/codecomplete.gif)

## Features

- Compiler support for .cairo files
- Live diagnostic highlighting for compile errors
- Quick fixes with suggestions provided by Cairo/StarkNet compiler
- Go to definitions for imports
- Code completion for imports

## IDE support

### VS Code

[Cairo language support extension](https://marketplace.visualstudio.com/items?itemName=ericglau.cairo-ls)

### Vim

[Vim setup instructions](VIM.md)

### How to use with other IDEs

1. In an empty directory, run the following to install the language server:
```
npm install cairo-ls
```
2. Configure a language client for your IDE to launch the language server with the following command (replace `YOUR_DIRECTORY` with your directory from step 1):
```
node YOUR_DIRECTORY/cairo-ls/node_modules/cairo-ls/out/server.js --stdio
```