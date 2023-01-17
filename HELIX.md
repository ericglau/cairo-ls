# Cairo Language Server for Helix

- In the directory of your choosing, install the `cairo-ls` language server. For example, use following structure:

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