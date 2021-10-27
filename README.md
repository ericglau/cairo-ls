# Language support for Cairo

[Cairo](https://www.cairo-lang.org/) language support for VS Code.

This project implements a Cairo language server and VS Code extension to help with writing Cairo programs for StarkNet.

**Note**: This is an early preview release and is still in active development.

![](images/main.gif)

## Features

- Compiler support for Cairo/StarkNet .cairo files
- Auto-detects StarkNet contracts
- Live diagnostic highlighting for Cairo/StarkNet compile errors without needing to save the file
- Quick fixes with suggestions provided by Cairo/StarkNet compiler
- Go to definitions for imported modules and functions, and functions within the same file 
- Hover documentation (minimal for now)
- Snippet insertion for Cairo templates (minimal for now)

Right-click menu commands to interact with Cairo:
- Compile Cairo program
- Compile StarkNet contract
- Run Cairo program

## Setup

1. Follow [Cairo environment setup steps](https://www.cairo-lang.org/docs/quickstart.html).
2. If using a virtual environment, start VS Code from within that terminal according to the instructions in the above link.
3. Install this extension along with [StarkWare's Cairo extension (.vsix file)](https://github.com/starkware-libs/cairo-lang/releases).
4. Open a .cairo file and start editing.
