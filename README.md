# 会员空间平台 · AI 助手对话组件（订单 1862 交付工程）

演示用的会员空间平台工作台，重点交付 AI 助手对话组件：流式接收、停止生成、断线重连、503 暂停分支与按会话保留的输入草稿。技术栈为 React 18 + TypeScript + TDesign React，构建 Vite，测试 Vitest + @testing-library/react，另带一个可注入故障的 mock SSE 服务。

页面里出现的会员企业名称（星澜科技、云栖生物、恒泰智造）、会员编号与资料全部为虚构演示数据，与任何真实企业无关。

## 目录结构

```
mock-server/sse.mjs                     可注入断线 / 503 的 mock SSE 服务
src/components/assistant/Composer.tsx   多行输入区：IME 保护、长度上限、空白拦截、草稿
src/components/assistant/StopButton.tsx 生成中的停止按钮
src/components/assistant/RetryBanner.tsx 重连进度与「重试」按钮
src/components/assistant/AssistantChat.tsx 面板装配：消息列表、停止、重试、新会话
src/hooks/useAssistantStream.ts         流式状态机：重连退避、中止、503 分支、重试复用原问题
src/lib/sse.ts                          增量 SSE 解析器（跨 chunk、心跳、八种事件）
tests/                                  Vitest 单元测试与组件测试（10 个文件 46 个用例）
docs/checks/                            干净环境下四条验证命令的真实输出
docs/screenshots/                       真实浏览器截图
```

## 依赖与运行环境

- Node.js ≥ 20（本次验证在 Node v26.13.1 + npm 11.20.0 上完成）。
- 包管理器 npm；仓库自带 package-lock.json。
- 需要联网安装依赖（默认 registry 与镜像均可）。
- 不需要数据库、不需要 Redis、不需要任何密钥或环境变量；mock 服务只监听本机回环地址。

## 跑起来

```bash
npm install                 # 安装依赖
npm run mock                # 终端 A：启动 mock SSE 服务，默认 http://127.0.0.1:8787
npm run dev                 # 终端 B：启动前端，默认 http://127.0.0.1:5173
```

Vite 把 /api 代理到 MOCK_TARGET（默认 http://127.0.0.1:8787），浏览器里直接访问 http://127.0.0.1:5173 即可。

如果要在浏览器里看「中途断线 → 重连 → 重试」，请让前端直连 mock 服务，不要把请求交给 Vite 代理：

```bash
# Windows PowerShell
$env:VITE_API_BASE = "http://127.0.0.1:8787"; npm run dev
# macOS / Linux
VITE_API_BASE=http://127.0.0.1:8787 npm run dev
```

原因是开发代理会在上游连接被掐断后继续维持浏览器这一侧的连接，浏览器端看不到断流；直连时 socket 一断，前端就进入重连退避。

### mock 服务的故障注入

```bash
node mock-server/sse.mjs --mode=normal      # 正常流式返回全部事件
node mock-server/sse.mjs --mode=drop        # 每次请求都是发 2 个 delta 后直接掐断，用于看重连与「重试」
node mock-server/sse.mjs --mode=drop-once   # 每个消息只断一次，重试能成功
node mock-server/sse.mjs --mode=disabled    # 返回 503 {"code":"ASSISTANT_DISABLED"}
node mock-server/sse.mjs --mode=ratelimit   # 返回 503 {"code":"RATE_LIMITED"}
node mock-server/sse.mjs --mode=slow        # 每 400ms 一个 delta，方便看停止按钮
```

也可以不改启动参数，在 POST 体里带上 `mode` 字段单次覆盖：

```bash
curl -N -X POST http://127.0.0.1:8787/api/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id":"spaces-101","question":"会员空间的对接流程是什么","mode":"drop"}'
```

`GET /api/health` 返回当前默认模式，`POST /api/assistant/cancel` 是停止生成时调用的取消接口。

## 验证命令

```bash
npm ci                      # 或 npm install
npx vitest run              # 单元 + 组件测试
npx tsc --noEmit            # 类型检查
npx vite build              # 生产构建
```

四条命令在本仓库的 `docs/checks/` 里各有一份真实输出，末尾均带 EXIT=0。

## 截图与浏览器验证（可选）

`tools/screenshots.mjs` 用 Playwright 驱动本机已有的 Chromium，把输入区、草稿恢复、流式、停止、重连、503 两个分支各截一张图，并把断言值写进 `docs/screenshots/screenshots.log`。它不在默认依赖里，需要时单独装：

```bash
npm i -D playwright
# 若本机没有 Playwright 自带浏览器，用环境变量指向已有 Chromium
$env:CHROME_PATH = "$env:USERPROFILE\AppData\Local\ms-playwright\chromium-1255\chrome-win64\chrome.exe"
node tools/screenshots.mjs
```

## 行为要点

1. **输入区**：Enter 发送，Shift+Enter 换行；`compositionstart` 到 `compositionend` 之间按键不发送，同时读取 keydown 自带的 `isComposing`，中文输入法选词回车不会误发。
2. **长度**：按 Unicode 码点计数（中文一个字算一个），2000 字可发，2001 字起保留文本但禁用发送并给出提示；纯空格、全角空格、纯换行都不算内容。
3. **流式**：解析器按行增量处理，一条事件跨任意个网络分片也只派发一次，`: ping` 心跳行被忽略；message_start、delta、tool_call、tool_confirmation_required、tool_result、citation、message_end、error 八种事件各自落到消息上，未知事件名只记日志。
4. **断线**：读取失败后自动重连 3 次，间隔 1000 / 2000 / 4000 毫秒，加上首发共 4 次请求；仍失败则展示「重试」，点击后用原问题重发，重连过程只有一条助手消息，不重复插入。
5. **停止**：生成中点「停止」会先中止本地读取再调取消接口，被中止的请求不再进入重连退避。
6. **503**：`ASSISTANT_DISABLED` 时输入框与发送按钮禁用并显示「助手已暂停使用」，且不重连；`RATE_LIMITED` 等其它 503 只提示，不禁用输入。
7. **草稿**：未发送内容按会话写入 sessionStorage（键 `assistant:draft:{sessionId}`），关闭面板再打开仍在，不同会话互不覆盖；发送成功或点「新会话」后清空。

## 已知边界

- 草稿存 sessionStorage，标签页关闭即失效；跨标签页同步不在本单范围。
- 重连退避没有加随机抖动，按需求固定的 1000 / 2000 / 4000 毫秒执行。
- mock 服务只做演示与联调，不含鉴权与限流。
