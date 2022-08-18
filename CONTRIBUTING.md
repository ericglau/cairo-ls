# Contributing

Contributions are welcome.  

This project is set up as a language server and a VS Code language client, both which conform to the [Language Server Protocol](https://langserver.org/).

## Project layout

```
.
├── client // Language Client
│   ├── src
│   │   └── extension.ts // Language Client entry point
├── package.json // The extension manifest.
└── server // Language Server
    └── src
        └── server.ts // Language Server entry point
```

## Running the project from source

- Run `npm install` in this folder. This installs all necessary npm modules in both the client and server folder
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the client and server.
- Switch to the 'Run and Debug' view (View -> Run).
- Select `Launch Client` from the drop down in the 'Run and Debug' panel.
- Click the green arrow to Start Debugging.
- If you want to debug the server as well, use the launch configuration `Attach to Server` instead of `Launch Client`
- In the [Extension Development Host] instance of VSCode, open a Cairo .cairo file.
