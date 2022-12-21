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

- In the directory of your choosing, install the cairo-ls language server. I propose the following structure:

- `cd && mkdir code && cd code && mkdir lsp && cd lsp`
- `npm install cairo-ls`
- Create a script that runs the cairo-ls entry point in `~/code/lsp`:
  - `touch scripts/cairols.sh`
  - `hx scripts/cairols.sh`
  - Write the following content in the script:
  ```bash
  # ~/code/lsp/scripts/cairols.sh

  #!/bin/bash
  node ~/code/lsp/node_modules/cairo-ls/out/server.js --stdio
  ```

- Link this script to your $PATH, let's pretend you're using zsh as your preferred shell:
  - `hx ~/.zshrc`
  - Add the following line to your `.zshrc` file: `export PATH="$PATH:/Users/<YOUR_USERNAME>/code/lsp/scripts"`

- You can now set up the Helix language config for Cairo. Add these lines to your `languages.toml` file in your Helix config.
  ```toml
  # ~/.config/helix/languages.toml
  [[language]]
  name = "cairo"
  scope = "source.cairo"
  injection-regex = "cairo"
  file-types = ["cairo"]
  indent = { tab-width = 2, unit = "  " }
  comment-token = "#"
  language-server = { command = "cairols.sh" }
   ```

If needed, you can refer to [a former issue](https://github.com/helix-editor/helix/issues/5245) on the Helix repo.

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
