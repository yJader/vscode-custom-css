const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const msg = require("./messages").messages;
const uuid = require("uuid");
const fetch = require("node-fetch");
const Url = require("url");

const AUTO_DISABLED_BASE_HASH = "autoDisabledBaseHash";
const PATCH_HASH_PATTERN = /<!-- !! VSCODE-CUSTOM-CSS-CONFIG-HASH ([0-9a-f]+) !! -->/;

async function activate(context) {
	const loc = locateWorkbench();
	if (!loc) return;
	const [workbenchDir, htmlPath] = loc;
	let autoPatchPromise;

	function locateWorkbench() {
		const appDir = require.main
			? path.dirname(require.main.filename)
			: globalThis._VSCODE_FILE_ROOT;
		if (!appDir) {
			vscode.window.showInformationMessage(msg.unableToLocateVsCodeInstallationPath);
			return null;
		}

		const basePath = path.join(appDir, "vs", "code");
		const workbenchDirCandidates = [
			// v1.102+ path
			path.join(basePath, "electron-browser", "workbench"),
			path.join(basePath, "electron-browser"),
			// old path
			path.join(basePath, "electron-sandbox", "workbench"),
			path.join(basePath, "electron-sandbox")
		];

		const htmlFileNameCandidates = [
			"workbench-dev.html", // VSCode dev
			"workbench.esm.html", // VSCode ESM
			"workbench.html", // VSCode
			"workbench-apc-extension.html" // Cursor
		];

		for (const workbenchDirCandidate of workbenchDirCandidates) {
			for (const htmlFileNameCandidate of htmlFileNameCandidates) {
				const htmlPathCandidate = path.join(workbenchDirCandidate, htmlFileNameCandidate);
				if (fs.existsSync(htmlPathCandidate)) {
					return [workbenchDirCandidate, htmlPathCandidate];
				}
			}
		}

		vscode.window.showInformationMessage(msg.unableToLocateVsCodeInstallationPath);
		return null;
	}

	function BackupFilePath(sessionId) {
		return path.join(workbenchDir, `workbench.${sessionId}.bak-custom-css`);
	}

	function hashContent(content) {
		return crypto.createHash("sha256").update(content, "utf8").digest("hex");
	}

	function resolveVariable(key) {
		const variables = {
			cwd: () => process.cwd(),
			userHome: () => os.homedir(),
			workspaceFolder: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
			execPath: () => process.env.VSCODE_EXEC_PATH ?? process.execPath,
			pathSeparator: () => path.sep,
			"/": () => path.sep
		};

		if (key in variables) return variables[key]();

		if (key.startsWith("env:")) {
			const [_, envKey, optionalDefault] = key.split(":");
			return process.env[envKey] ?? optionalDefault ?? "";
		}
	}

	function parsedUrl(url) {
		if (/^file:/.test(url)) {
			// regex matches any "${<RESOLVE>}" and replaces with resolveVariable(<RESOLVE>)
			// eg: "HELLO ${userHome} WORLD" -> "HELLO /home/username WORLD"
			return url.replaceAll(
				/\$\{([^{}]+)\}/g,
				(substr, key) => resolveVariable(key) ?? substr
			);
		}
		return url;
	}

	async function getContent(url) {
		if (/^file:/.test(url.toString())) {
			const fp = Url.fileURLToPath(url);
			return await fs.promises.readFile(fp);
		}
		const response = await fetch(url);
		return response.buffer();
	}

	function clearExistingPatches(html) {
		html = html.replace(
			/<!-- !! VSCODE-CUSTOM-CSS-START !! -->[\s\S]*?<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n*/,
			""
		);
		html = html.replace(
			/<!-- !! VSCODE-CUSTOM-CSS-(?:SESSION-ID|CONFIG-HASH) [\w-]+ !! -->\n*/g,
			""
		);
		// Clear indicator JS that was injected into body.
		html = html.replace(
			/<script>\/\* eslint-env browser \*\/[\s\S]*?__CUSTOM_CSS_JS_INDICATOR_CLS[\s\S]*?<\/script>\n*/g,
			""
		);
		return html;
	}

	function getPatchHash(html) {
		return html.match(PATCH_HASH_PATTERN)?.[1] ?? null;
	}

	async function readWorkbench() {
		const raw = await fs.promises.readFile(htmlPath, "utf-8");
		const clean = clearExistingPatches(raw);
		return {
			raw,
			clean,
			baseHash: hashContent(clean),
			patchHash: getPatchHash(raw)
		};
	}

	function patchIsProperlyConfigured(config) {
		return config && config.imports instanceof Array;
	}

	function autoPatchIsEnabled(config) {
		return config.autoEnable !== false && config.imports.some(Boolean);
	}

	// #### Patch content ########################################################

	async function patchHtml(config) {
		let res = "";
		for (const item of config.imports) {
			const imp = await patchHtmlForItem(item);
			if (imp) res += imp;
		}
		return res;
	}

	async function patchHtmlForItem(url) {
		if (!url || typeof url !== "string") return "";

		let parsed;
		try {
			parsed = new Url.URL(url);
			const ext = path.extname(parsed.pathname);
			parsed = parsedUrl(url);
			const fetched = await getContent(parsed);
			if (ext === ".css") return `<style>${fetched}</style>`;
			if (ext === ".js") return `<script>${fetched}</script>`;
			throw new Error(`Unsupported extension type: ${ext}`);
		} catch (e) {
			console.error(e);
			vscode.window.showWarningMessage(msg.cannotLoad(parsed?.toString() ?? url));
			return "";
		}
	}

	async function getIndicatorJs() {
		let indicatorJsPath;
		const ext =
			vscode.extensions.getExtension("yjader.vscode-custom-css-auto") ||
			vscode.extensions.getExtension("be5invis.vscode-custom-css");
		if (ext && ext.extensionPath) {
			indicatorJsPath = path.resolve(ext.extensionPath, "src/statusbar.js");
		} else {
			indicatorJsPath = path.resolve(__dirname, "statusbar.js");
		}
		return await fs.promises.readFile(indicatorJsPath, "utf-8");
	}

	async function buildPatch(config) {
		const injectHTML = await patchHtml(config);
		let indicatorJS = "";
		if (config.statusbar) indicatorJS = await getIndicatorJs();
		return {
			injectHTML,
			indicatorJS,
			contentHash: hashContent(`${injectHTML}\0${indicatorJS}`)
		};
	}

	async function writePatch(cleanHtml, sessionId, patch) {
		let html = cleanHtml.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*\/?\s*>/i, "");
		if (!html.includes("</head>")) {
			throw new Error("Unable to find the workbench head element.");
		}

		html = html.replace(
			/(<\/head>)/,
			`<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID ${sessionId} !! -->\n` +
				`<!-- !! VSCODE-CUSTOM-CSS-CONFIG-HASH ${patch.contentHash} !! -->\n` +
				"<!-- !! VSCODE-CUSTOM-CSS-START !! -->\n" +
				patch.injectHTML +
				"<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n</head>"
		);

		if (patch.indicatorJS) {
			html = html.replace(/(<\/body>)/, `<script>${patch.indicatorJS}</script>\n</body>`);
		}
		await fs.promises.writeFile(htmlPath, html, "utf-8");
	}

	// #### Backup ################################################################

	async function createBackup(sessionId, cleanHtml) {
		try {
			await fs.promises.writeFile(BackupFilePath(sessionId), cleanHtml, "utf-8");
		} catch (e) {
			vscode.window.showInformationMessage(msg.admin);
			throw e;
		}
	}

	async function restoreBackup(backupFilePath) {
		try {
			if (fs.existsSync(backupFilePath)) {
				await fs.promises.unlink(htmlPath);
				await fs.promises.copyFile(backupFilePath, htmlPath);
				return true;
			}
			return false;
		} catch (e) {
			vscode.window.showInformationMessage(msg.admin);
			throw e;
		}
	}

	async function deleteBackupFiles() {
		const htmlDirItems = await fs.promises.readdir(workbenchDir);
		for (const item of htmlDirItems) {
			if (item.endsWith(".bak-custom-css")) {
				await fs.promises.unlink(path.join(workbenchDir, item));
			}
		}
	}

	async function getBackupUuid(htmlFilePath) {
		try {
			const htmlContent = await fs.promises.readFile(htmlFilePath, "utf-8");
			return htmlContent.match(
				/<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID ([0-9a-fA-F-]+) !! -->/
			)?.[1] ?? null;
		} catch (e) {
			vscode.window.showInformationMessage(msg.somethingWrong + e);
			throw e;
		}
	}

	async function uninstallImpl() {
		const backupUuid = await getBackupUuid(htmlPath);
		if (!backupUuid) return false;
		const backupPath = BackupFilePath(backupUuid);
		const restored = await restoreBackup(backupPath);
		await deleteBackupFiles();
		return restored;
	}

	// #### Commands and automatic repair ########################################

	async function reloadWindow() {
		await vscode.commands.executeCommand("workbench.action.reloadWindow");
	}

	async function applyPatch({ automatic = false, current: providedCurrent, patch: providedPatch } = {}) {
		const config = vscode.workspace.getConfiguration("vscode_custom_css");
		if (!patchIsProperlyConfigured(config)) {
			if (!automatic) vscode.window.showInformationMessage(msg.notConfigured);
			return false;
		}

		const current = providedCurrent ?? (await readWorkbench());
		const patch = providedPatch ?? (await buildPatch(config));
		if (current.patchHash === patch.contentHash) return false;

		const sessionId = uuid.v4();
		try {
			await createBackup(sessionId, current.clean);
			await writePatch(current.clean, sessionId, patch);
			await context.globalState.update(AUTO_DISABLED_BASE_HASH, undefined);
		} catch (e) {
			vscode.window.showInformationMessage(msg.admin);
			if (automatic) console.error(e);
			return false;
		}

		if (automatic) {
			console.log(msg.autoEnabled);
			await reloadWindow();
		} else {
			enabledRestart();
		}
		return true;
	}

	async function ensureAutoPatch() {
		const config = vscode.workspace.getConfiguration("vscode_custom_css");
		if (!patchIsProperlyConfigured(config) || !autoPatchIsEnabled(config)) return;

		const current = await readWorkbench();
		const manuallyDisabledBaseHash = context.globalState.get(AUTO_DISABLED_BASE_HASH);
		if (manuallyDisabledBaseHash === current.baseHash) return;

		const patch = await buildPatch(config);
		if (current.patchHash === patch.contentHash) return;

		await applyPatch({ automatic: true, current, patch });
	}

	function scheduleAutoPatch() {
		if (autoPatchPromise) return autoPatchPromise;
		autoPatchPromise = ensureAutoPatch()
			.catch(error => {
				console.error(error);
				vscode.window.showWarningMessage(msg.autoFailed(error.message));
			})
			.finally(() => {
				autoPatchPromise = undefined;
			});
		return autoPatchPromise;
	}

	async function cmdInstall() {
		await applyPatch();
	}

	async function cmdReinstall() {
		await uninstallImpl();
		await applyPatch();
	}

	async function cmdUninstall() {
		const restored = await uninstallImpl();
		const current = await readWorkbench();
		await context.globalState.update(AUTO_DISABLED_BASE_HASH, current.baseHash);
		if (restored) {
			disabledRestart();
		} else {
			vscode.window.showInformationMessage(msg.already_disabled);
		}
	}

	function enabledRestart() {
		vscode.window.showInformationMessage(msg.enabled, msg.restartIde).then(btn => {
			if (btn === msg.restartIde) reloadWindow();
		});
	}

	function disabledRestart() {
		vscode.window.showInformationMessage(msg.disabled, msg.restartIde).then(btn => {
			if (btn === msg.restartIde) reloadWindow();
		});
	}

	const installCustomCSS = vscode.commands.registerCommand(
		"extension.installCustomCSS",
		cmdInstall
	);
	const uninstallCustomCSS = vscode.commands.registerCommand(
		"extension.uninstallCustomCSS",
		cmdUninstall
	);
	const updateCustomCSS = vscode.commands.registerCommand(
		"extension.updateCustomCSS",
		cmdReinstall
	);
	const configurationWatcher = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration("vscode_custom_css")) return scheduleAutoPatch();
		return undefined;
	});

	context.subscriptions.push(installCustomCSS);
	context.subscriptions.push(uninstallCustomCSS);
	context.subscriptions.push(updateCustomCSS);
	context.subscriptions.push(configurationWatcher);

	console.log("vscode-custom-css-auto is active!");
	console.log("Workbench directory", workbenchDir);
	console.log("Main HTML file", htmlPath);

	await scheduleAutoPatch();
}

exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {}
exports.deactivate = deactivate;
