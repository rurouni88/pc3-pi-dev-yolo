/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before:
 * - Dangerous bash commands: rm -rf, sudo, chmod/chown 777
 * - Any write or edit tool call (file modifications) — UNLESS the file
 *   is in a whitelisted folder.
 *
 * Whitelist: add folder paths (relative to cwd) below. Files inside those
 * folders bypass the permission prompt.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const dangerousPatterns = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

// ── Whitelist: absolute folder paths that bypass the permission prompt ─
// Files in these folders (or subfolders) won't trigger a confirmation.
const whitelistFolders: string[] = [
	process.env.HOME ? `${process.env.HOME}/Dev/GIT/pc3-pi-dev-yolo` : "",
	process.env.HOME ? `${process.env.HOME}/.pi/agent/extensions` : "",
];
// ──────────────────────────────────────────────────────────────────────

function getRelativePath(path: string, cwd: string): string {
	if (path.startsWith(cwd)) {
		return path.slice(cwd.length).replace(/^\//, "") || ".";
	}
	return path;
}

function isWhitelisted(path: string): boolean {
	return whitelistFolders.some((folder) => {
		// absolute path match
		return path === folder || path.startsWith(folder + "/");
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// --- Bash: check for dangerous patterns ---
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			const isDangerous = dangerousPatterns.some((p) => p.test(command));

			if (isDangerous) {
				const choice = await ctx.ui.select(
					`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`,
					["Yes", "No"],
				).catch(() => undefined);

				if (choice !== "Yes") {
					return { block: true, reason: "Blocked by user" };
				}
			}

			return undefined;
		}

		// --- write / edit: require confirmation (unless whitelisted) ---
		if (event.toolName === "write" || event.toolName === "edit") {
			const path = event.input.path as string;

			if (isWhitelisted(path)) {
				return undefined; // skip — whitelisted
			}

			const relPath = getRelativePath(path, ctx.cwd);

			let detail = "";
			if (event.toolName === "write") {
				const content = (event.input as { content: string }).content;
				const bytes = new Blob([content]).size;
				detail = `\n  Size: ${bytes > 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`}`;
			} else if (event.toolName === "edit") {
				const edits = (event.input as { edits: Array<{ oldText: string; newText: string }> }).edits;
				detail = `\n  ${edits.length} edit(s)`;
			}

			const choice = await ctx.ui.select(
				`✏️ ${event.toolName}:\n\n  ${relPath}${detail}\n\nAllow?`,
				["Yes", "No"],
			).catch(() => undefined);

			if (choice !== "Yes") {
				return { block: true, reason: `Blocked by user` };
			}
		}

		return undefined;
	});
}
