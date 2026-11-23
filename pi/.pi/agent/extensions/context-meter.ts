/**
 * Context Meter - replaces the built-in footer so context usage is shown as
 * absolute tokens plus a progress bar instead of only a percentage.
 *
 *   before:  12.5%/1.0M (auto)
 *   after:   [████░░░░░░] 12.5k/1.0M (12.5%) (auto)
 *
 * Everything else (pwd/branch/session name line, token stats, cost, model on
 * the right, extension status line) mirrors pi's built-in footer.
 */

import type { ExtensionAPI, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const BAR_WIDTH = 10;
const BAR_FILLED = "█";
const BAR_EMPTY = "░";
const SETTINGS_TTL_MS = 5000;

/** Format token counts for compact footer display (matches built-in footer). */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const relativeToHome = relative(resolve(home), resolve(cwd));
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/** Render a fixed-width [████░░░░░░] bar. `percent` is null when tokens are unknown. */
function renderBar(percent: number | null): string {
	if (percent === null) return `[${BAR_EMPTY.repeat(BAR_WIDTH)}]`;
	const ratio = Math.max(0, Math.min(1, percent / 100));
	let filled = Math.round(ratio * BAR_WIDTH);
	if (filled === 0 && ratio > 0) filled = 1;
	if (filled === BAR_WIDTH && ratio < 1) filled = BAR_WIDTH - 1;
	return `[${BAR_FILLED.repeat(filled)}${BAR_EMPTY.repeat(BAR_WIDTH - filled)}]`;
}

function readCompactionEnabled(path: string): boolean | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { compaction?: { enabled?: boolean } };
		return parsed?.compaction?.enabled;
	} catch {
		return undefined;
	}
}

/**
 * Auto-compaction state is not exposed on ExtensionContext, so read it from
 * settings (project overrides global; defaults to enabled). Cached briefly.
 */
function makeAutoCompactionReader(cwd: string): () => boolean {
	let cached = true;
	let checkedAt = 0;
	return () => {
		const now = Date.now();
		if (now - checkedAt < SETTINGS_TTL_MS) return cached;
		checkedAt = now;
		const project = readCompactionEnabled(join(cwd, ".pi", "settings.json"));
		const global = readCompactionEnabled(join(homedir(), ".pi", "agent", "settings.json"));
		cached = project ?? global ?? true;
		return cached;
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
			const isAutoCompactionEnabled = makeAutoCompactionReader(ctx.cwd);

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					// --- cumulative usage across the whole session ---
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;
					let latestCacheHitRate: number | undefined;

					const add = (usage: {
						input: number;
						output: number;
						cacheRead: number;
						cacheWrite: number;
						cost: { total: number };
					}) => {
						input += usage.input;
						output += usage.output;
						cacheRead += usage.cacheRead;
						cacheWrite += usage.cacheWrite;
						cost += usage.cost.total;
					};

					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const usage = entry.message.usage;
							add(usage);
							const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
							latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
						} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
							add(entry.message.usage);
						} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
							add(entry.usage);
						}
					}

					// --- pwd line ---
					let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
					const branch = footerData.getGitBranch();
					if (branch) pwd = `${pwd} (${branch})`;
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) pwd = `${pwd} • ${sessionName}`;

					// --- stats line (left) ---
					const statsParts: string[] = [];
					if (input) statsParts.push(`↑${formatTokens(input)}`);
					if (output) statsParts.push(`↓${formatTokens(output)}`);
					if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
					if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
					if ((cacheRead > 0 || cacheWrite > 0) && latestCacheHitRate !== undefined) {
						statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
					}

					// Kimi Coding is subscription-backed despite using API-key auth.
					const usingSubscription = ctx.model?.provider === "kimi-coding";
					if (cost || usingSubscription) {
						statsParts.push(`$${cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
					}

					// --- context usage: [bar] used/window (percent) ---
					const contextUsage = ctx.getContextUsage();
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const tokens = contextUsage?.tokens ?? null;
					const percent = contextUsage?.percent ?? null;
					const autoIndicator = isAutoCompactionEnabled() ? " (auto)" : "";

					const bar = renderBar(percent);
					const usedStr = tokens === null ? "?" : formatTokens(tokens);
					const percentStr = percent === null ? "" : ` (${percent.toFixed(1)}%)`;
					const contextDisplay = `${bar} ${usedStr}/${formatTokens(contextWindow)}${percentStr}${autoIndicator}`;

					const percentValue = percent ?? 0;
					statsParts.push(
						percentValue > 90
							? theme.fg("error", contextDisplay)
							: percentValue > 70
								? theme.fg("warning", contextDisplay)
								: contextDisplay,
					);

					if (process.env.PI_EXPERIMENTAL === "1") {
						statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
					}

					let statsLeft = statsParts.join(" ");
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}

					// --- stats line (right): model, thinking level, provider ---
					const minPadding = 2;
					const modelName = ctx.model?.id || "no-model";
					let rightSideWithoutProvider = modelName;
					if (ctx.model?.reasoning) {
						const thinkingLevel = ctx.thinkingLevel || "off";
						rightSideWithoutProvider =
							thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
					}
					let rightSide = rightSideWithoutProvider;
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
						if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
							rightSide = rightSideWithoutProvider;
						}
					}

					const rightSideWidth = visibleWidth(rightSide);
					let statsLine: string;
					if (statsLeftWidth + minPadding + rightSideWidth <= width) {
						statsLine = statsLeft + " ".repeat(width - statsLeftWidth - rightSideWidth) + rightSide;
					} else {
						const availableForRight = width - statsLeftWidth - minPadding;
						if (availableForRight > 0) {
							const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
							const padding = " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight)));
							statsLine = statsLeft + padding + truncatedRight;
						} else {
							statsLine = statsLeft;
						}
					}

					// statsLeft may contain color codes ending in a reset, which would clear an
					// outer dim wrapper - so dim the two halves independently.
					const dimStatsLeft = theme.fg("dim", statsLeft);
					const dimRemainder = theme.fg("dim", statsLine.slice(statsLeft.length));
					const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
					const lines = [pwdLine, dimStatsLeft + dimRemainder];

					// --- extension statuses ---
					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const statusLine = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => sanitizeStatusText(text))
							.join(" ");
						lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	});
}
