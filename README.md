# Custom CSS and JS

### **SPECIAL NOTE: If Visual Studio Code complains about that it is corrupted, simply click “Don't show again” or install [Fix VSCode Checksums Next](https://marketplace.visualstudio.com/items?itemName=RimuruChan.vscode-fix-checksums-next).**
### **NOTE: This fork automatically reapplies Custom CSS and JS after a VS Code update.**
### **NOTE: Configuration changes are automatically reapplied when `vscode_custom_css.autoEnable` is enabled.**
### **Starting from extension version 6.0, to be compatible with VSCode 1.58, the CSS/JS files being applied will be inlined into VSCode's workbench.**

Custom CSS to your Visual Studio Code. Based on [robertohuertasm](https://github.com/robertohuertasm)’s [vscode-icons](https://github.com/robertohuertasm/vscode-icons).

## Getting Started

1. Install this extension.

2. Add to `settings.json`:

   ```json
       "vscode_custom_css.imports": [""]
   ```

   **VERY IMPORTANT**: Items in `vscode_custom_css.imports` must be **URL**s. Plain file paths are **NOT URLs**.

   - **Windows File URL Example**: `file:///C:/Users/MyUserName/Documents/custom.css`
     - The `C:/` part is **REQUIRED.**

   - **MacOS and Linux File URL Example**: `file:///Users/MyUserName/Documents/custom.css`
   - [See here](https://en.wikipedia.org/wiki/File_URI_scheme) for more details.

3. Restart Visual Studio Code with proper permission to modify itself:

   1. **Windows**: Restart with Administrator Permission.

   2. **MacOS and Linux**: See instructions below.

4. Activate command "Enable Custom CSS and JS" once. The fork will automatically reapply the patch when VS Code replaces its installation files or when the imported CSS/JS configuration changes.


## Extension commands

As you know to access the command palette and introduce commands you can use ***F1*** (all OSes), ***Ctrl+Shift+P*** (Windows & Linux) or ***Cmd+Shift+P*** (OS X).

- ***Enable Custom CSS and JS***: It enables custom CSS and JS URLs listed in “`vscode_custom_css.imports`”, an array containing URLs of your custom CSS and JS files, in your user settings.
- ***Disable Custom CSS and JS***: It will disable custom CSS.
- ***Reload Custom CSS and JS***: Disable and then re-enable it.

Automatic repair compares a hash of the rendered imports and the clean VS Code workbench. It writes the patch and reloads the window only when either one changes. Set `vscode_custom_css.autoEnable` to `false` to disable automatic repair. The `Disable Custom CSS and JS` command remains a manual opt-out for the current VS Code installation; an upgrade changes the clean workbench hash and enables repair again.

## Windows users

**In Windows, make sure you run your Visual Studio Code in Administrator mode before enabling or disabling your custom style!**

## Mac and Linux users
**The extension would NOT work if Visual Studio Code cannot modify itself.** The cases include:

- Code files being read-only, like on a read-only file system or,
- Code is not started with the permissions to modify itself.

**You need to claim ownership on Visual Studio Code's installation directory, by running this command**:

```sh
sudo chown -R $(whoami) "$(which code)"
sudo chown -R $(whoami) /usr/share/code
```

The placeholder `<Path to Visual Studio Code>` means the path to VSCode installation. It is typically:

- `/Applications/Visual Studio Code.app/Contents/MacOS/Electron`, on MacOS;
- `/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron`, on MacOS when using Insiders branch;
- `/usr/share/code`, on most Linux;
- `/usr/lib/code/` or `/opt/visual-studio-code` on Arch Linux.

Mac and Linux package managers may have customized installation path. Please double check your path is correct.

## Variables

File URIs support VSCode variables like: `${userHome}`. It just replaces supported variables with their values before parsing into a file path. Supported variables are:

- `${cwd}`
- `${userHome}`
- `${workspaceFolder}`
- `${execPath}`
- `${pathSeparator}`, `${/}`

`${workspaceFolder}` represents to the root directory of the workspace currently open in VSCode.
It also supports env variables like `${env:ENV_VAR_NAME}` and you can specify a fallback value like `${env:ENV_VAR:defaultvalue}`


### Example

```json
"vscode_custom_css.imports": ["file://${userHome}/.config/vscode-styles.css"]
```

# Disclaimer

This extension modifies some Visual Studio Code files so use it at your own risk.
Currently, icons are not supported by the extension functionality that Visual Studio Code provides so this extension solves this issue by injecting code into:

- `electron-browser/workbench/workbench.html`.

The extension will keep a copy of the original file in case something goes wrong. That's what the disable command will do for you.

The fork detects when a VS Code update replaces the modified workbench and reapplies the configured imports automatically. The first repair reloads the window once.

Take into account that this extension is still in beta, so you may find some bugs while playing with it. Please, report them to [the issues section of the Github's repo](https://github.com/yJader/vscode-custom-css/issues).

**Please, leave a review if you can, so the Visual Studio Code Team can know that this is a very demanded feature and, maybe, they can then provide a proper way to extend the IDE regarding icons and customizations soon enough. ;D**

More file extensions will be supported shortly!
