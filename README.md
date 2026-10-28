# dsh-web-search-router

DeepSeek Harness（DSH）的网页搜索路由插件。向 `ctx.web` 注册两个搜索 provider，并自带「插件 → 内置插件配置」里的可视化配置卡片。

- `auto`：跟随当前会话模型。官方 DeepSeek 路由沿用 DeepSeek 搜索与凭据；第三方模型用它自己的厂商 API Key 与端点。
- `custom`：与会话模型无关，固定使用界面里配置的端点 / 模型 / 凭据引用。

## 为什么需要它

DSH 内置的 `dsh-web-search-deepseek` 严格要求 Anthropic 的 `web_search_tool_result` 结构化块。KSYUN 这类网关会执行服务端 `web_search`（`usage.server_tool_use.web_search_requests >= 1`），但只返回正文 + `[n](url)` 引用，于是内置 provider 会报 `WEB_PROVIDER_ERROR`。

本插件先取结构化块，取不到再从正文引用解析 `sources[]`，因此两类端点都能用。

## 前置条件

- DeepSeek Harness 0.2.x（桌面端，或 `dsh web`）
- Node.js ≥ 22
- pnpm ≥ 10；若机器上没有 pnpm，可用 DSH 自带 runtime 里的 node + pnpm（命令见下）

## 安装

以下以解压到 `D:\dsh-plugins\web-search-router` 为例，换成自己的绝对路径即可。

### 1. 解压并安装依赖

压缩包不含 `node_modules`，先在插件目录安装自己的依赖（`@deepseek-ai/schemastery`）：

```powershell
cd D:\dsh-plugins\web-search-router
pnpm install
```

没有 pnpm 时，用 DSH runtime：

```powershell
$rt = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies"
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.mjs" install
```

### 2. 链接进 profile

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add "link:D:/dsh-plugins/web-search-router"
```

（没有 pnpm 时同样用上面的 `node pnpm.mjs add "link:D:/dsh-plugins/web-search-router"`。）

安装后 profile 的 `package.json` 应出现：

```json
"@local/dsh-web-search-router": "link:D:/dsh-plugins/web-search-router"
```

> 必须用 `link:`，不要用 `file:`：`file:` 协议下 pnpm 会复制包内容，运行时读副本，改源码不生效。

### 3. 在 profile 的 `cordis.patch.yml` 里接线

```yaml
- id: web
  name: "@deepseek-ai/dsh-web"
  config:
    searchProvider: auto      # 或 custom
    fetchProvider: http
- insert:
    - id: web-search-router
      name: "@local/dsh-web-search-router"
```

- `id` 决定 settings 命名空间，界面表单按它绑定，保持 `web-search-router` 不要改。
- `name` 必须与包名一致，Client 半侧按包名挂载。

### 4. 重启 DSH

完全退出应用再启动（只关窗口不够）；Web 端则重启 `dsh web` 进程。Host 侧代码与 `Config` 只在启动时加载。

### 5. 验证

- 界面：插件 → 内置插件配置 → 网页搜索路由，应能看到 `自动 / 自定义端点` 两个选项。
- 搜索：让模型搜一次；若开了 `debugLog`，可看日志是否新增一行：

  ```json
  {"at":"...","label":"Vendor (ksyun)","providerId":"ksyun","endpoint":"https://kspmas.ksyun.com/v1/messages","model":"deepseek-v4.1-flash-1017"}
  ```

## 卸载

1. 删除 `cordis.patch.yml` 里的 `- id: web` 覆盖与 `web-search-router` 插入项（或把 `searchProvider` 改回 `deepseek-official`）；
2. `pnpm remove @local/dsh-web-search-router`；
3. 可选：删除插件目录。

## 配置

### 界面

「插件 → 内置插件配置 → 网页搜索路由」（或插件页标签「搜索路由」）：

- 单选 `自动（跟随会话模型）` / `自定义端点`，保存写入 `web.searchProvider`。
- 选中「自定义端点」展开三个输入框，保存写入本插件配置：
  - `customBaseURL`（默认 `https://kspmas.ksyun.com/v1`，程序追加 `/messages`）
  - `customModel`（默认 `deepseek-v4.1-flash-1017`）
  - `customApiKeyEnv`（默认 `KSYUN_API_KEY`，凭据引用名；密钥本身不写进设置）

改了这些值后下一次搜索即生效，不需要重启（只有 `Config` 结构变化才需要）。

### 配置文件 / 环境变量

| 字段 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `officialBaseURL` | `DEEPSEEK_SEARCH_BASE_URL`（仅未设字段时） | `https://api.deepseek.com/anthropic/v1` | 官方分支端点 |
| `officialApiKeyEnv` | — | `DEEPSEEK_API_KEY` | 官方 API Key 引用 |
| `officialModel` | — | 会话模型 | 官方分支模型 |
| `vendorBaseURLs` | — | `{}` | 按 provider id 覆盖厂商端点，如 `{ ksyun: "https://kspmas.ksyun.com/v1" }` |
| `vendorModel` | — | 会话模型 | 厂商分支模型 |
| `customBaseURL` | `DSH_SEARCH_CUSTOM_BASE_URL` | `https://kspmas.ksyun.com/v1` | 自定义分支端点 |
| `customModel` | `DSH_SEARCH_CUSTOM_MODEL` | `deepseek-v4.1-flash-1017` | 自定义分支模型 |
| `customApiKeyEnv` | `DSH_SEARCH_CUSTOM_API_KEY_ENV` | `KSYUN_API_KEY` | 自定义分支凭据引用 |
| `apiVersion` | — | `2023-06-01` | `anthropic-version` |
| `maxTokens` | — | `2048` | 单次搜索生成上限 |
| `maxUses` | — | `1` | 一次请求内服务端搜索次数 |
| `timeoutMs` | — | `60000` | 超时（与调用方取消合并） |
| `debugLog` | `DSH_SEARCH_DEBUG_LOG` | 空 | 打开后每次搜索追加一行 JSON 诊断 |

厂商分支的凭据引用取自该 provider 在 `llm-pi-ai` 的 `apiKeyEnv`；没有时按 `<PROVIDER>_API_KEY` 派生。

## 工作原理

```
web_search 工具
   └─ ctx.web.search()
        ├─ provider "auto"   ── 读 Session 最新 request/context.provider
        │     ├─ deepseek* → DeepSeek Messages + 账号 token / DEEPSEEK_API_KEY
        │     └─ 其他      → 该 provider 的 baseURL + apiKeyEnv（来自 settings）
        └─ provider "custom" ── customBaseURL + customModel + customApiKeyEnv
                                 ↓
                 POST {baseURL}/messages  tools:[web_search_20250305]
                                 ↓
                 结构化块 web_search_tool_result 优先
                 否则解析正文 [n](url) / 参考列表 → sources[]
```

- 官方分支：`deepseek-account` 路由优先用 `ctx.deepseekAccount.resolveToken(endpoint)`，其余用 `DEEPSEEK_API_KEY`。
- 厂商分支：从 `ctx.settings.describe()` 读 `llm-pi-ai` 的 provider 配置，所以聊天换 key、换地址后搜索自动跟上。
- 每次搜索仍是一次模型调用（延迟 + token 计费）。

## 开发

```
web-search-router/
├─ index.js            Host 半侧：Config + 两个 provider（ctx.web）
├─ client.js           浏览器半侧：插件页卡片（__ModuleLoader__ 格式）
├─ test/smoke.mjs      真实端点冒烟测试
├─ package.json        dsh.client 声明 + schemastery 依赖
└─ README.md
```

```bash
npm run check     # node --check 两个入口
npm run smoke     # 需要 KSYUN_API_KEY（或 SMOKE_API_KEY），可选 SMOKE_BASE_URL / SMOKE_MODEL
```

开发时的本地接线（本机已这样配置）：profile 的 `plugins/web-search-router` 是指向本目录的 Junction，依赖写 `link:plugins/web-search-router`。

规则：

- **Host 代码（`index.js`、`Config`）改动 → 重启 DSH 生效**。DSH 的内置 HMR 忽略 `node_modules`，而插件通过 `node_modules/@local/...` 解析。
- **Client 代码（`client.js`）改动 → 刷新页面生效**；若界面仍是旧版，先确认 profile 里不是 `file:` 副本。
- **配置值（界面/patch）改动 → 即时生效**，volatile 引用下一次搜索就读取。

## 分享 / 发布

当前包名 `@local/dsh-web-search-router` 且 `private: true`，只适合本地链接。要发布：

1. 改 `name`（例如 `dsh-web-search-router`）并删除 `private`；
2. 确认 `dependencies` 只有 `@deepseek-ai/schemastery`（`@deepseek-ai/*` 客户端包走宿主的模块表，不打包）；
3. `npm publish`；
4. 安装方用 `dsh plugin add <name>`，或在 `cordis.patch.yml` 的 `insert` 里把 `name` 改成新包名（`id: web-search-router` 可保持不变）。

也可以直接分享整个目录（含 `client.js`），对方用 `link:` 或 `file:` 安装；注意 `file:` 会复制，开发场景请用 `link:`。

## 已知限制

- 厂商/自定义端点必须是 Anthropic Messages 协议并接受 `web_search_20250305`；纯 OpenAI 兼容端点不行。
- 无结构化块时 `sources[]` 来自正文引用，可能不完整。
- 官方分支同样返回答案正文（内置 provider 只返回来源），这是本插件的统一行为。
- `debugLog` 不会自动轮转，长期启用请自行清理。

## License

MIT
