# Lede for VS Code (unpublished)

Syntax highlighting for `.lede` files. This folder is a minimal extension with no dependencies and no build step. It is not
published to any marketplace, and nothing here is a release.

The grammar is `../textmate/lede.tmLanguage.json`, referenced by relative path, so there is one copy to keep fresh. The
extension has no comment syntax because Lede has no comments.

## Install from a checkout

`code --install-extension` needs a packaged `.vsix`, and building one needs `vsce`, which this repo does not depend on. The
route that needs nothing extra is the extension development host:

1. Open this folder (`editors/vscode`) in VS Code.
2. Press F5 (Run, then Start Debugging). If VS Code asks for an environment, choose "VS Code Extension Development".
3. In the window that opens, open any `.lede` file. The language mode in the status bar reads "Lede".

To keep it installed without packaging, copy or symlink the `editors` folder into your extensions folder so that
`lede-language/` holds `package.json` and `../textmate/` still resolves. The relative grammar path means `editors/vscode` and
`editors/textmate` must stay side by side. Untested: that route; only the development host is the documented one.
