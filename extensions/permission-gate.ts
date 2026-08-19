/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before:
 * - Dangerous bash commands: rm -rf, sudo, chmod/chown 777
 * - Any write or edit tool call (file modifications) — UNLESS the file
 *   is in a whitelisted folder.
 *
 * Session-scoped permissions:
 *   When the user approves a path, it's remembered for the duration of the
 *   current session. No re-prompt for the same path.
 *
 * Whitelist: add folder paths (relative to cwd) below. Files inside those
 * folders bypass the permission prompt entirely.
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

// ── Session-scoped permission cache ──
// Stores approved paths for the duration of the session.
const approvedPaths = new Set<string>();
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

function hasBeenApproved(path: string): boolean {
	return approvedPaths.has(path);
}

function approvePath(path: string): void {
	approvedPaths.add(path);
}

export default function (pi: ExtensionAPI) {
	// ── session_start: optional notification that session permissions are active ──
	// (keeps the cache alive for the session; no action needed since it's in-memory)
	// ──────────────────────────────────────────────────────────────────────

	// ── session_shutdown: clear the cache when session ends ──
	pi.on("session_shutdown", async () => {
		approvedPaths.clear();
	});

	// ──────────────────────────────────────────────────────────────────────

	// Custom tool: list approved paths for the session
	pi.registerTool({
		name: "approved_paths",
		label: "Approved Paths",
		description: "List all file paths that have been approved for write/edit this session.",
		parameters: {
			type: "object",
			properties: {},
		},
		async execute() {
			const paths = Array.from(approvedPaths);
			return {
				content: [
					{
						type: "text",
						text: paths.length > 0
							? `Approved paths for this session (${paths.length}):\n${paths.map((p) => `  • ${p}`).join("\n")}`
							: "No paths have been approved this session.",
					},
				],
			};
		},
	});

	// Custom tool: approve a path manually
	pi.registerTool({
		name: "approve_path",
		label: "Approve Path",
		description: "Approve a file path for write/edit operations without further prompts (session-scoped).",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The absolute path to approve",
				},
			},
			required: ["path"],
		},
		async execute(_toolCallId, params: { path: string }) {
			approvePath(params.path);
			return {
				content: [{ type: "text", text: `✅ Path approved for this session: ${params.path}` }],
			};
		},
	});

	// Custom tool: clear approved paths
	pi.registerTool({
		name: "clear_approved_paths",
		label: "Clear Approved Paths",
		description: "Clear all session-scoped path approvals.",
		parameters: {
			type: "object",
			properties: {},
		},
		async execute() {
			const count = approvedPaths.size;
			approvedPaths.clear();
			return {
				content: [{ type: "text", text: `🗑️ Cleared ${count} approved path(s).` }],
			};
		},
	});

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

		// --- write / edit: require confirmation (unless whitelisted or previously approved) ---
		if (event.toolName === "write" || event.toolName === "edit") {
			const path = event.input.path as string;

			// Check: whitelisted → skip
			if (isWhitelisted(path)) {
				return undefined;
			}

			// Check: already approved this session → skip
			if (hasBeenApproved(path)) {
				return undefined;
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

			// Remember this approval for the rest of the session
			approvePath(path);
		}

		return undefined;
	});
}
