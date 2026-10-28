/**
 * DeepSeek Harness web-search router.
 *
 * Registers two `ctx.web` search providers:
 *
 * - `auto`  — follows the conversation model:
 *     * official DeepSeek routes (`deepseek-account`, `deepseek-official`, any `deepseek*`)
 *       search through DeepSeek's Anthropic-compatible Messages endpoint with the
 *       DeepSeek account token or `DEEPSEEK_API_KEY` — the shipped behaviour.
 *     * any other route (e.g. a pi-ai custom provider such as `ksyun`) searches through
 *       that provider's own endpoint and credential (`apiKeyEnv`), so one vendor key
 *       covers both chat and search.
 * - `custom` — an explicit endpoint/model/key reference, independent of the conversation.
 *
 * `web.searchProvider` selects which one runs; the Plugins page card writes that value.
 *
 * Ksyun-style endpoints execute the server-side `web_search` tool but answer with plain
 * text plus `[n](url)` citations instead of Anthropic's `web_search_tool_result` blocks,
 * so structured blocks are preferred and citations are used as a fallback.
 */

import { appendFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";

export const name = "web-search-router";
export const inject = ["web"];

export const AUTO_ID = "auto";
export const CUSTOM_ID = "custom";

const DEFAULT_OFFICIAL_BASE_URL = "https://api.deepseek.com/anthropic/v1";
const DEFAULT_OFFICIAL_API_KEY_ENV = "DEEPSEEK_API_KEY";
const DEFAULT_CUSTOM_BASE_URL = "https://kspmas.ksyun.com/v1";
const DEFAULT_CUSTOM_MODEL = "deepseek-v4.1-flash-1017";
const DEFAULT_CUSTOM_API_KEY_ENV = "KSYUN_API_KEY";
const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_MAX_USES = 1;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ANSWER_CHARS = 6_000;

/**
 * Volatile settings fields. They are what the Plugins-page card edits (and what
 * `ctx.settings` exposes as the `web-search-router` namespace); the same values
 * stay editable in the profile patch for deployments that prefer files.
 */
export const Config = z.object({
	officialBaseURL: z.string().default(DEFAULT_OFFICIAL_BASE_URL).volatile(),
	officialApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_OFFICIAL_API_KEY_ENV).volatile(),
	officialModel: z.string().volatile(),
	vendorBaseURLs: z.dict(z.string()).default({}).volatile(),
	vendorModel: z.string().volatile(),
	customBaseURL: z.string().default(DEFAULT_CUSTOM_BASE_URL).volatile(),
	customModel: z.string().default(DEFAULT_CUSTOM_MODEL).volatile(),
	customApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_CUSTOM_API_KEY_ENV).volatile(),
	apiVersion: z.string().default(DEFAULT_API_VERSION).volatile(),
	maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS).volatile(),
	maxUses: z.number().step(1).min(1).default(DEFAULT_MAX_USES).volatile(),
	timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS).volatile(),
	debugLog: z.string().volatile(),
});

const MARKDOWN_LINK = /\[([^\]\n]{0,200})\]\(\s*(https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const REFERENCE_LINE = /^\s*(?:\d+[.)]|[-*])\s+(https?:\/\/\S+)\s*$/gm;
const NUMERIC_LABEL = /^\[?\s*\d+\s*\]?$/;

function readConfig(config, key, fallback) {
	const value = config?.[key];
	if (value === undefined || value === null) return fallback;
	if (typeof value === "object" && typeof value.get === "function") {
		const inner = value.get();
		return inner === undefined || inner === null ? fallback : inner;
	}
	return value;
}

function positiveInteger(value, fallback) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function webError(message, code, cause) {
	const error = new Error(message);
	error.code = code;
	if (cause !== undefined) error.cause = cause;
	return error;
}

function trimUrl(raw) {
	let url = raw.trim();
	while (url.length > 0 && /[)"'.,;，。；]/.test(url.at(-1))) url = url.slice(0, -1);
	return url;
}

function titleFor(label, url) {
	const trimmed = label.trim();
	if (trimmed.length > 0 && !NUMERIC_LABEL.test(trimmed)) return trimmed;
	try {
		const parsed = new URL(url);
		const last = parsed.pathname.split("/").filter(Boolean).at(-1);
		const decoded = last === undefined ? "" : decodeURIComponent(last);
		return decoded.length > 0 ? `${parsed.hostname} · ${decoded}` : parsed.hostname;
	} catch {
		return url;
	}
}

function pushSource(sources, seen, label, rawUrl) {
	const url = trimUrl(rawUrl);
	if (!URL.canParse(url) || seen.has(url)) return;
	seen.add(url);
	sources.push({ url, title: titleFor(label, url) });
}

/** Sources declared by Anthropic-style `web_search_tool_result` blocks. */
function structuredSources(blocks) {
	const sources = [];
	const seen = new Set();
	const snippets = new Map();
	for (const block of blocks) {
		if (block?.type !== "text") continue;
		for (const cite of block.citations ?? []) {
			if (cite?.url && cite.cited_text && !snippets.has(cite.url)) snippets.set(cite.url, cite.cited_text);
		}
	}
	for (const block of blocks) {
		if (block?.type !== "web_search_tool_result") continue;
		for (const item of block.content ?? []) {
			if (item?.type !== "web_search_result" || !item.url || seen.has(item.url)) continue;
			seen.add(item.url);
			const snippet = snippets.get(item.url);
			sources.push({
				url: item.url,
				...(item.title ? { title: item.title } : {}),
				...(snippet ? { snippet } : {}),
				...(item.page_age ? { publishedAt: item.page_age } : {}),
			});
		}
	}
	return sources;
}

/** Sources cited as Markdown links or reference lines in the answer text. */
function citationSources(text) {
	const sources = [];
	const seen = new Set();
	for (const match of text.matchAll(MARKDOWN_LINK)) pushSource(sources, seen, match[1] ?? "", match[2]);
	for (const match of text.matchAll(REFERENCE_LINE)) pushSource(sources, seen, "", match[1]);
	return sources;
}

function answerText(blocks) {
	return blocks
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n\n")
		.trim();
}

function operationSignal(signal, timeoutMs) {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error(`web search timed out after ${timeoutMs} ms`));
	}, timeoutMs);
	const onAbort = () => controller.abort(signal?.reason);
	if (signal !== undefined) {
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		dispose: () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		},
	};
}

/** The latest request route recorded by the initiating Session. */
function sessionRoute(ctx) {
	try {
		return ctx.get("agents")?.currentInitiator()?.session?.requestContext?.() ?? {};
	} catch {
		return {};
	}
}

function isOfficialProvider(providerId) {
	if (typeof providerId !== "string" || providerId.length === 0) return false;
	return providerId === "deepseek-account" || providerId === "deepseek-official" || providerId.startsWith("deepseek");
}

/** The live pi-ai provider profile that serves `providerId`, from settings. */
function vendorProfile(ctx, providerId) {
	let rows;
	try {
		rows = ctx.get("settings")?.describe?.({}) ?? [];
	} catch {
		return undefined;
	}
	for (const row of rows) {
		const providers = row?.value?.providers;
		if (providers === undefined || providers === null || typeof providers !== "object") continue;
		const profile = providers[providerId];
		if (profile !== undefined && profile !== null) return profile;
	}
	return undefined;
}

function deriveKeyRef(providerId) {
	return `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

async function resolveApiKey(ctx, ref, signal) {
	if (signal?.aborted === true) throw webError("web search aborted", "WEB_ABORTED", signal.reason);
	const credentials = ctx.get("credentials");
	if (credentials !== undefined) {
		try {
			const resolved = await credentials.resolve(ref);
			if (resolved?.value?.length > 0) return resolved.value;
		} catch (error) {
			if (signal?.aborted === true) throw webError("web search aborted", "WEB_ABORTED", signal.reason);
			throw webError(`web search credential resolution failed for "${ref}": ${String(error)}`, "WEB_PROVIDER_ERROR", error);
		}
	}
	const ambient = process.env[ref];
	if (ambient !== undefined && ambient.length > 0) return ambient;
	return undefined;
}

/** One Anthropic Messages request with the native web_search tool. */
async function messagesSearch(options) {
	const { ctx, baseURL, apiKey, authHeaders, model, query, maxResults, maxUses, maxTokens, timeoutMs, apiVersion, signal, label, providerId, debugLog } = options;
	const endpoint = `${baseURL.replace(/\/+$/, "")}/messages`;
	const headers = {
		"content-type": "application/json",
		accept: "application/json",
		"anthropic-version": apiVersion,
		"user-agent": "deepseek-harness-web-search-router/0.1.0",
		...(authHeaders ?? { "x-api-key": apiKey, authorization: `Bearer ${apiKey}` }),
	};
	const body = {
		model,
		max_tokens: maxTokens,
		messages: [{ role: "user", content: `Perform a web search for the query: ${query}` }],
		tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }],
		thinking: { type: "disabled" },
	};

	if (typeof debugLog === "string" && debugLog.length > 0) {
		try {
			appendFileSync(debugLog, `${JSON.stringify({ at: new Date().toISOString(), label, providerId, endpoint, model })}\n`);
		} catch {}
	}

	const deadline = operationSignal(signal, timeoutMs);
	let response;
	let text;
	try {
		response = await fetch(endpoint, {
			method: "POST",
			redirect: "error",
			headers,
			body: JSON.stringify(body),
			signal: deadline.signal,
		});
		text = await response.text();
	} catch (error) {
		if (signal?.aborted === true) throw webError("web search aborted", "WEB_ABORTED", signal.reason);
		if (deadline.timedOut()) throw webError(`${label} search timed out after ${timeoutMs} ms`, "WEB_PROVIDER_ERROR");
		throw webError(`${label} search request failed at ${endpoint}: ${String(error)}`, "WEB_PROVIDER_ERROR", error);
	} finally {
		deadline.dispose();
	}

	if (!response.ok) {
		let detail = text.slice(0, 500);
		try {
			const parsed = JSON.parse(text);
			detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? detail);
		} catch {}
		throw webError(`${label} search API error (HTTP ${response.status}) at ${endpoint}: ${detail}`, "WEB_PROVIDER_ERROR");
	}

	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw webError(`${label} returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", error);
	}

	const blocks = Array.isArray(parsed.content) ? parsed.content : [];
	const answer = answerText(blocks);
	const structured = structuredSources(blocks);
	const sources = structured.length > 0 ? structured : citationSources(answer);
	const capped = sources.slice(0, positiveInteger(maxResults, 8));
	if (capped.length === 0 && answer.length === 0) {
		throw webError(
			`${label} returned no sources and no answer text for "${query}" (server_tool_use=${JSON.stringify(parsed.usage?.server_tool_use ?? null)})`,
			"WEB_PROVIDER_ERROR",
		);
	}
	return {
		...(answer.length > 0 ? { content: answer.slice(0, MAX_ANSWER_CHARS) } : {}),
		sources: capped,
		truncated: sources.length > capped.length || answer.length > MAX_ANSWER_CHARS,
	};
}

function commonOptions(ctx, config) {
	return {
		ctx,
		apiVersion: readConfig(config, "apiVersion", DEFAULT_API_VERSION),
		maxTokens: positiveInteger(readConfig(config, "maxTokens", DEFAULT_MAX_TOKENS), DEFAULT_MAX_TOKENS),
		maxUses: positiveInteger(readConfig(config, "maxUses", DEFAULT_MAX_USES), DEFAULT_MAX_USES),
		timeoutMs: positiveInteger(readConfig(config, "timeoutMs", DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS),
		debugLog: readConfig(config, "debugLog", "") || process.env.DSH_SEARCH_DEBUG_LOG || "",
	};
}

/** `auto`: official routes use DeepSeek credentials, everything else its own provider. */
async function searchAuto(ctx, config, request, signal) {
	const route = sessionRoute(ctx);
	const providerId = typeof route.provider === "string" ? route.provider : "";
	const shared = commonOptions(ctx, config);

	if (providerId.length === 0 || isOfficialProvider(providerId)) {
		const baseURL = readConfig(config, "officialBaseURL", process.env.DEEPSEEK_SEARCH_BASE_URL ?? DEFAULT_OFFICIAL_BASE_URL);
		const apiKeyEnv = readConfig(config, "officialApiKeyEnv", DEFAULT_OFFICIAL_API_KEY_ENV);
		let authHeaders;
		if (providerId === "deepseek-account") {
			const endpoint = `${String(baseURL).replace(/\/+$/, "")}/messages`;
			const token = await ctx.get("deepseekAccount")?.resolveToken(endpoint);
			if (token) authHeaders = { "x-dsh-auth-token": token };
		}
		if (authHeaders === undefined) {
			const apiKey = await resolveApiKey(ctx, apiKeyEnv, signal);
			if (apiKey === undefined) {
				throw webError(
					`official DeepSeek search has no API key for "${apiKeyEnv}"; store it through the credentials service (the Models page writes it) or export it before launching DSH, or use the custom search provider`,
					"WEB_PROVIDER_CREDENTIAL_MISSING",
				);
			}
			authHeaders = { "x-api-key": apiKey, authorization: `Bearer ${apiKey}` };
		}
		return messagesSearch({
			...shared,
			baseURL,
			authHeaders,
			model: readConfig(config, "officialModel", "") || route.model || "deepseek-v4-flash",
			query: request.query,
			maxResults: request.maxResults,
			signal,
			label: "DeepSeek official",
			providerId: providerId.length > 0 ? providerId : "official",
		});
	}

	const profile = vendorProfile(ctx, providerId) ?? {};
	const overrides = readConfig(config, "vendorBaseURLs", {}) ?? {};
	const baseURL = overrides[providerId] ?? profile.baseURL ?? readConfig(config, "customBaseURL", DEFAULT_CUSTOM_BASE_URL);
	const apiKeyEnv = profile.apiKeyEnv ?? deriveKeyRef(providerId);
	const model = readConfig(config, "vendorModel", "") || route.model || profile.models?.[0]?.id || readConfig(config, "customModel", DEFAULT_CUSTOM_MODEL);
	const apiKey = await resolveApiKey(ctx, apiKeyEnv, signal);
	if (apiKey === undefined) {
		throw webError(
			`vendor search for route "${providerId}" has no API key for "${apiKeyEnv}"; store that reference through the credentials service or export it, or switch the web search provider to a custom endpoint`,
			"WEB_PROVIDER_CREDENTIAL_MISSING",
		);
	}
	return messagesSearch({
		...shared,
		baseURL,
		apiKey,
		model,
		query: request.query,
		maxResults: request.maxResults,
		signal,
		label: `Vendor (${providerId})`,
		providerId,
	});
}

/** `custom`: one explicitly configured Anthropic-compatible endpoint. */
async function searchCustom(ctx, config, request, signal) {
	const shared = commonOptions(ctx, config);
	const baseURL = readConfig(config, "customBaseURL", process.env.DSH_SEARCH_CUSTOM_BASE_URL ?? DEFAULT_CUSTOM_BASE_URL);
	const apiKeyEnv = readConfig(config, "customApiKeyEnv", process.env.DSH_SEARCH_CUSTOM_API_KEY_ENV ?? DEFAULT_CUSTOM_API_KEY_ENV);
	const model = readConfig(config, "customModel", process.env.DSH_SEARCH_CUSTOM_MODEL ?? DEFAULT_CUSTOM_MODEL);
	const apiKey = await resolveApiKey(ctx, apiKeyEnv, signal);
	if (apiKey === undefined) {
		throw webError(
			`custom search has no API key for "${apiKeyEnv}"; store it through the credentials service, export it, or set "customApiKeyEnv"/"apiKey" in the web-search-router config`,
			"WEB_PROVIDER_CREDENTIAL_MISSING",
		);
	}
	return messagesSearch({
		...shared,
		baseURL,
		apiKey,
		model,
		query: request.query,
		maxResults: request.maxResults,
		signal,
		label: "Custom",
		providerId: "custom",
	});
}

class RouterProvider {
	id = AUTO_ID;
	#ctx;
	#config;
	constructor(ctx, config) {
		this.#ctx = ctx;
		this.#config = config;
	}
	available() {
		return true;
	}
	search(request, signal) {
		return searchAuto(this.#ctx, this.#config, request, signal);
	}
}

class CustomProvider {
	id = CUSTOM_ID;
	#ctx;
	#config;
	constructor(ctx, config) {
		this.#ctx = ctx;
		this.#config = config;
	}
	available() {
		return true;
	}
	search(request, signal) {
		return searchCustom(this.#ctx, this.#config, request, signal);
	}
}

export { RouterProvider, CustomProvider, messagesSearch, citationSources, structuredSources };

export function apply(ctx, config) {
	ctx.web.registerSearchProvider(new RouterProvider(ctx, config));
	ctx.web.registerSearchProvider(new CustomProvider(ctx, config));
}
