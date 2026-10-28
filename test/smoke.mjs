/**
 * Live smoke test for the `custom` provider against a real Anthropic-compatible endpoint.
 *
 *   KSYUN_API_KEY=... node test/smoke.mjs
 *   SMOKE_API_KEY=... SMOKE_BASE_URL=https://host/v1 SMOKE_MODEL=model-id node test/smoke.mjs
 *
 * No DSH runtime is needed: a fake ctx supplies credentials and an empty settings plane.
 */
import { apply } from "../index.js";

const key = process.env.KSYUN_API_KEY ?? process.env.SMOKE_API_KEY;
const baseURL = process.env.SMOKE_BASE_URL ?? "https://kspmas.ksyun.com/v1";
const model = process.env.SMOKE_MODEL ?? "deepseek-v4.1-flash-1017";

if (!key) {
  console.log("skip: set KSYUN_API_KEY or SMOKE_API_KEY to run the live smoke test");
  process.exit(0);
}

let custom;
const ctx = {
  web: {
    registerSearchProvider(provider) {
      if (provider.id === "custom") custom = provider;
    },
  },
  get(name) {
    if (name === "credentials") return { resolve: async () => ({ value: key }) };
    if (name === "settings") return { describe: () => [] };
    if (name === "agents") {
      return { currentInitiator: () => ({ session: { requestContext: () => ({ provider: "smoke" }) } }) };
    }
    return undefined;
  },
};

apply(ctx, {
  customBaseURL: baseURL,
  customModel: model,
  customApiKeyEnv: "KSYUN_API_KEY",
});

if (custom === undefined) {
  console.error("smoke failed: apply() did not register the custom provider");
  process.exit(1);
}

const started = Date.now();
const result = await custom.search({ query: "DeepSeek Harness", maxResults: 3 });
const elapsed = Date.now() - started;

console.log(`endpoint: ${baseURL}/messages`);
console.log(`model:    ${model}`);
console.log(`elapsed:  ${elapsed} ms`);
console.log(`sources:  ${result.sources.length} | content: ${result.content?.length ?? 0} chars | truncated: ${result.truncated}`);
for (const source of result.sources) console.log(`- ${source.title ?? source.url} | ${source.url}`);

if (result.sources.length === 0 && (result.content?.length ?? 0) === 0) {
  console.error("smoke failed: empty result");
  process.exit(1);
}
