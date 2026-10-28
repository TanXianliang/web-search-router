window.__ModuleLoader__.load({
	id: "@local/dsh-web-search-router",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let client_store = require("@deepseek-ai/dsh-client-store");

		/** The two providers this plugin registers with `ctx.web`. */
		const OPTIONS = [
			{
				id: "auto",
				title: "自动（跟随会话模型）",
				hint: "官方 DeepSeek 模型（账号或 API Key）沿用 DeepSeek 的搜索与凭据；第三方模型用它自己的厂商 API Key 与端点搜索。"
			},
			{
				id: "custom",
				title: "自定义端点",
				hint: "固定使用下面的端点 / 模型 / 凭据引用，与会话模型无关。"
			}
		];

		/** Namespaces this card edits. */
		const WEB_NS = "web";
		const ROUTER_NS = "web-search-router";

		/** Staged forms over the `web` selection and this plugin's own settings. */
		class RouterCardController {
			constructor(scopes, ctx) {
				this.scopes = scopes;
				this.ctx = ctx;
				this.selection = new primitives.SettingsFormModel(scopes.web, [primitives.settingsTextField("searchProvider")]);
				this.custom = new primitives.SettingsFormModel(scopes.router, [
					primitives.settingsTextField("customBaseURL"),
					primitives.settingsTextField("customModel"),
					primitives.settingsTextField("customApiKeyEnv")
				]);
				this.store = client_store.createSnapshotStore(this.projection());
				const publish = () => this.store.set(this.projection());
				this.unsubscribe = [
					this.selection.bind(() => this.selection.shell()).subscribe(publish),
					this.custom.bind(() => this.custom.shell()).subscribe(publish),
					scopes.web.subscribe(publish),
					scopes.router.subscribe(publish)
				];
			}

			projection() {
				const webShell = this.selection.shell();
				const routerShell = this.custom.shell();
				const snapshot = this.scopes.web.getSnapshot();
				const staged = this.selection.field("searchProvider").text;
				const current = staged !== undefined && staged.length > 0 ? staged : (snapshot.value?.searchProvider ?? "");
				return {
					available: webShell.available,
					routerAvailable: routerShell.available,
					writable: webShell.writable && routerShell.writable,
					dirty: webShell.dirty || routerShell.dirty,
					saving: webShell.saving || routerShell.saving,
					invalid: webShell.invalid || routerShell.invalid,
					failed: webShell.failed || routerShell.failed,
					current,
					options: OPTIONS,
					custom: {
						baseURL: this.custom.field("customBaseURL").text ?? "",
						model: this.custom.field("customModel").text ?? "",
						apiKeyEnv: this.custom.field("customApiKeyEnv").text ?? ""
					}
				};
			}

			choose(id) {
				this.selection.actions().edit("searchProvider", id);
			}

			editCustom(field, text) {
				this.custom.actions().edit(field, text);
			}

			async save() {
				if (this.custom.shell().available && this.custom.shell().dirty) {
					await this.custom.save();
					if (this.custom.shell().failed) return;
				}
				if (this.selection.shell().dirty) await this.selection.save();
			}

			discard() {
				this.selection.actions().discard();
				this.custom.actions().discard();
			}

			dispose() {
				for (const off of this.unsubscribe) off();
				this.selection.dispose();
				this.custom.dispose();
			}
		}

		function optionRow(option, state, disabled, choose) {
			return jsx_runtime.jsxs("label", {
				style: { display: "grid", gridTemplateColumns: "20px 1fr", gap: "8px", alignItems: "start", cursor: disabled ? "default" : "pointer" },
				children: [
					jsx_runtime.jsx("input", {
						type: "radio",
						name: "web-search-router-provider",
						checked: state.current === option.id,
						disabled,
						onChange: () => choose(option.id),
						style: { marginTop: "3px" }
					}),
					jsx_runtime.jsxs("span", {
						children: [
							jsx_runtime.jsx("span", { style: { display: "block" }, children: option.title }),
							jsx_runtime.jsx("span", {
								style: { display: "block", fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" },
								children: option.hint
							})
						]
					})
				]
			}, option.id);
		}

		function customField(id, label, hint, value, disabled, onEdit) {
			return jsx_runtime.jsxs("label", {
				style: { display: "grid", gap: "4px" },
				children: [
					jsx_runtime.jsx("span", { children: label }),
					jsx_runtime.jsx("input", {
						id,
						type: "text",
						value,
						disabled,
						onChange: (event) => onEdit(event.target.value),
						style: {
							padding: "6px 8px",
							borderRadius: "6px",
							border: "1px solid var(--dsw-alias-border-secondary, #444)",
							background: "var(--dsw-alias-bg-layer-1, transparent)",
							color: "var(--dsw-alias-label-primary)",
							font: "inherit"
						}
					}),
					jsx_runtime.jsx("span", {
						style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" },
						children: hint
					})
				]
			}, id);
		}

		function RouterCard(props) {
			const state = props.useSearchRouter((snapshot) => snapshot);
			if (props.view === "summary") return "自动跟随模型，或固定到自定义搜索端点。";
			const disabled = !state.writable || state.saving;
			const showCustom = state.current === "custom";
			return jsx_runtime.jsxs("div", {
				style: { display: "grid", gap: "12px", fontSize: "13px", lineHeight: 1.5 },
				children: [
					jsx_runtime.jsx("p", {
						style: { margin: 0, color: "var(--dsw-alias-label-primary)" },
						children: "搜索提供方"
					}),
					...state.options.map((option) => optionRow(option, state, disabled, props.choose)),
					showCustom
						? jsx_runtime.jsxs("div", {
							style: { display: "grid", gap: "10px", paddingLeft: "28px" },
							children: [
								state.routerAvailable
									? null
									: jsx_runtime.jsx("p", {
										style: { margin: 0, color: "var(--dsw-alias-label-tertiary)" },
										children: "自定义端点设置尚未加载：重启一次 DSH 后即可在此编辑。"
									}),
								customField(
									"web-search-router-base-url",
									"基础地址",
									"含 API 前缀，例如 https://kspmas.ksyun.com/v1；程序追加 /messages。",
									state.custom.baseURL,
									disabled || !state.routerAvailable,
									(text) => props.editCustom("customBaseURL", text)
								),
								customField(
									"web-search-router-model",
									"模型",
									"执行搜索的模型 ID，例如 deepseek-v4.1-flash-1017。",
									state.custom.model,
									disabled || !state.routerAvailable,
									(text) => props.editCustom("customModel", text)
								),
								customField(
									"web-search-router-key-ref",
									"凭据引用",
									"凭据库里的引用名，例如 KSYUN_API_KEY；密钥本身不写进设置。",
									state.custom.apiKeyEnv,
									disabled || !state.routerAvailable,
									(text) => props.editCustom("customApiKeyEnv", text)
								)
							]
						})
						: null,
					state.failed
						? jsx_runtime.jsx("p", {
							style: { margin: 0, color: "var(--dsw-alias-label-error, #d33)" },
							children: "保存失败，请重试。"
						})
						: null,
					jsx_runtime.jsxs("div", {
						style: { display: "flex", gap: "8px" },
						children: [
							jsx_runtime.jsx("button", {
								type: "button",
								disabled: disabled || !state.dirty,
								onClick: () => props.save(),
								children: state.saving ? "保存中…" : "保存"
							}),
							jsx_runtime.jsx("button", {
								type: "button",
								disabled: disabled || !state.dirty,
								onClick: () => props.discard(),
								children: "放弃修改"
							})
						]
					}),
					!state.available
						? jsx_runtime.jsx("p", {
							style: { margin: 0, color: "var(--dsw-alias-label-tertiary)" },
							children: "网页搜索设置当前不可用。"
						})
						: null
				]
			});
		}

		const inject = ["slots", "configForms"];

		function cardProps(card) {
			return {
				hooks: { searchRouter: card.store },
				choose: (id) => card.choose(id),
				editCustom: (field, text) => card.editCustom(field, text),
				save: () => card.save(),
				discard: () => card.discard()
			};
		}

		function apply(ctx) {
			const card = new RouterCardController({
				web: ctx.configForms.get(WEB_NS),
				router: ctx.configForms.get(ROUTER_NS)
			}, ctx);
			ctx.effect(() => () => card.dispose(), "web-search-router-ui: form");
			ctx.effect(() => ctx.configForms.whileServed([WEB_NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
				name: "plugins.item",
				id: "web-search-router",
				order: 21,
				label: () => "网页搜索路由",
				inject: () => cardProps(card)
			}, RouterCard))), "web-search-router-ui: page");
			ctx.effect(() => {
				try {
					return ctx.slots.inject("plugins.tab", () => ctx.slots.register({
						name: "plugins.tab",
						id: "web-search-router-tab",
						order: 10,
						label: () => "搜索路由",
						inject: () => cardProps(card)
					}, RouterCard));
				} catch {
					return undefined;
				}
			}, "web-search-router-ui: tab");
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
