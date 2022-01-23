# Language support for Cairo and StarkNet

[Cairo](https://www.cairo-lang.org/) language support for VS Code.

This project implements a Cairo language server and VS Code extension to help with writing Cairo contracts for StarkNet.

**Note**: This is an early preview release and is still in active development.

![](images/main.gif)

## Features

- Compiler support for Cairo/StarkNet .cairo files
- Auto-detects StarkNet contracts
- Live diagnostic highlighting for Cairo/StarkNet compile errors without needing to save the file
- Quick fixes with suggestions provided by Cairo/StarkNet compiler
- Go to definitions for imported modules, functions, and structs 
- Code completion for imports
- Hover documentation (minimal for now)

Right-click menu commands using [Nile](https://github.com/OpenZeppelin/nile):
- Nile - Clean
- Nile - Compile all
- Nile - Compile this contract
- Run tests with pytest

## Setup

1. Install Nile by following its [Getting started](https://github.com/OpenZeppelin/nile#getting-started) steps, or follow the [Cairo environment setup steps](https://www.cairo-lang.org/docs/quickstart.html).
3. If using a virtual environment, start VS Code from within that terminal according to the instructions [here](https://www.cairo-lang.org/docs/quickstart.html#visual-studio-code-setup).
4. Install this extension along with [StarkWare's Cairo extension (.vsix file)](https://github.com/starkware-libs/cairo-lang/releases).
5. Open a .cairo file and start editing.
