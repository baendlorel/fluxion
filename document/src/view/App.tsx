import { CodeBlock } from './CodeBlock.js';
import { Section } from './Section.js';

const startCode = `# 1) 安装依赖
pnpm install

# 2) 启动 fluxion（默认读取 ./dynamicDirectory）
pnpm dev

# 3) 启动文档站点（当前页面）
pnpm doc:dev`;

const configCode = `{
  "dynamicDirectory": "./dynamicDirectory",
  "host": "127.0.0.1",
  "port": 3000
}`;

const treeCode = `dynamicDirectory/
├── aaa/
│   ├── bb/
│   │   ├── cc/index.mjs      # 动态路由 /aaa/bb/cc（优先）
│   │   └── cc.mjs            # 动态路由 /aaa/bb/cc（次优先）
│   ├── public/app.js         # 静态资源 /aaa/public/app.js
│   └── page.html             # 静态资源 /aaa/page.html
├── index.mjs                 # 动态路由 /
└── _lib/
    ├── tool.mjs              # 不可路由（_ 前缀目录）
    └── helper.js             # 不可路由（_ 前缀目录）`;

const handlerCode = `// dynamicDirectory/aaa/bb/cc/index.mjs
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    method: req.method,
    url: req.url,
  }));
}`;

const routeDecisionCode = `请求进入后，按以下顺序判定：

1. 先匹配元接口 /_fluxion/*
2. URL 解析与安全校验：
   - 段不能为空、不能是 . 或 ..
   - 段不能包含 / 或 \\
   - 任意段以 _ 开头 => 直接 404
3. 动态路由判定（仅 .mjs 作为 handler）：
   - 先试 <path>/index.mjs
   - 再试 <path>.mjs
   - 命中后加载 default 导出并执行
4. 若动态未命中，再判定静态文件：
   - 仅 GET/HEAD
   - .mjs 永不当静态文件返回
   - 其他文件存在则直接返回
5. 仍未命中 => 404`;

const cacheCode = `handler 缓存键 = "mtimeMs:size"

- 首次访问：import(file://...?.v=mtime:size)
- 后续访问：
  - mtime/size 未变化 -> 复用缓存函数
  - mtime 或 size 变化 -> 重新 import 新版本

这意味着：只要文件内容导致 mtime 或 size 变化，下一次请求就会热更新。`;

const metaRoutesCode = `GET /_fluxion/routes

返回示例：
{
  "routes": {
    "handlers": [
      {
        "route": "/aaa/bb/cc",
        "file": "aaa/bb/cc/index.mjs",
        "version": "1740751930123.123:289"
      }
    ],
    "staticFiles": [
      {
        "route": "/aaa/public/app.js",
        "file": "aaa/public/app.js",
        "version": "1740751930456.456:31"
      }
    ]
  }
}`;

const healthzCode = `GET /_fluxion/healthz

返回示例：
{
  "ok": true,
  "now": 1740751930999
}`;

const uploadCode = `curl -X POST \
  'http://127.0.0.1:3000/_fluxion/upload?filename=my-module.tar.gz' \
  -H 'content-type: application/octet-stream' \
  --data-binary @./my-module.tar.gz`;

const uploadRuleCode = `上传仅支持：.tar / .tar.gz / .tgz

解压后布局判定：

A) 仅一个顶层目录
   -> moduleName = 顶层目录名
   -> 安装为 dynamicDirectory/<moduleName>

B) 多个顶层项（文件或目录）
   -> moduleName = 压缩包文件名（去扩展名）
   -> 所有顶层项复制到 dynamicDirectory/<moduleName>

C) 解压后没有可用内容
   -> 400（Invalid archive structure）`;

const requestMapCode = `访问路径 -> 结果

/aaa/bb/cc         -> 查找 aaa/bb/cc/index.mjs，再查 aaa/bb/cc.mjs
/aaa/public/app.js -> 若文件存在，作为静态文件返回
/aaa/bb/cc.mjs     -> 不直接暴露源码，返回 404
/_lib/x            -> _ 前缀目录，不路由，返回 404
/_fluxion/routes   -> 元接口，返回当前路由快照`;

export function App() {
  return (
    <div class="doc-page">
      <div class="bg-glow bg-glow-left" />
      <div class="bg-glow bg-glow-right" />

      <header class="hero">
        <p class="eyebrow">Fluxion 使用说明（中文版）</p>
        <h1 class="hero-title">文件即路由：.mjs 动态处理，.js 静态返回</h1>
        <p class="hero-copy">
          Fluxion 是一个基于 Node.js HTTP 的元服务器。它不要求固定的 server/web 目录，直接以
          <code class="inline-code">dynamicDirectory</code>
          中的文件结构来决定路由行为。
        </p>
        <div class="hero-actions">
          <a href="#quick-start" class="button button-primary">
            快速开始
          </a>
          <a href="#decision" class="button button-ghost">
            判定规则
          </a>
        </div>
      </header>

      <nav class="toc">
        <a href="#quick-start">快速开始</a>
        <a href="#layout">目录约定</a>
        <a href="#decision">判定顺序</a>
        <a href="#handler">动态加载</a>
        <a href="#meta-api">元接口</a>
        <a href="#upload">上传规则</a>
        <a href="#examples">请求示例</a>
      </nav>

      <main class="content">
        <Section id="quick-start" title="快速开始" lead="先跑起来，再按规则组织文件。">
          <div class="grid-two">
            <article class="panel">
              <h3 class="panel-title">启动命令</h3>
              <CodeBlock code={startCode} />
            </article>
            <article class="panel">
              <h3 class="panel-title">核心配置</h3>
              <p class="panel-note">
                运行时配置等价于下面 JSON。默认值来自环境变量：
                <code class="inline-code">DYNAMIC_DIRECTORY</code>、
                <code class="inline-code">HOST</code>、
                <code class="inline-code">PORT</code>。
              </p>
              <CodeBlock code={configCode} />
            </article>
          </div>
        </Section>

        <Section
          id="layout"
          title="目录约定"
          lead="不再强制 server/web。所有内容都直接放在 dynamicDirectory 下。"
        >
          <div class="panel">
            <CodeBlock code={treeCode} />
            <ul class="check-list panel-note-list">
              <li>
                <code class="inline-code">.mjs</code>：作为动态 handler，必须
                <code class="inline-code">export default (req, res) =&gt; {}</code>。
              </li>
              <li>
                <code class="inline-code">.js</code>：作为静态资源返回（也是推荐的前端脚本后缀）。
              </li>
              <li>其他非 .mjs 文件（如 .html/.css/.json）也会按静态文件处理。</li>
              <li>
                目录名以 <code class="inline-code">_</code> 开头（如 <code class="inline-code">_lib/</code>）永不路由。
              </li>
            </ul>
          </div>
        </Section>

        <Section
          id="decision"
          title="请求判定顺序（最重要）"
          lead="同一个请求会严格按固定顺序处理，这决定了最终命中哪个文件。"
        >
          <div class="grid-two">
            <article class="panel">
              <h3 class="panel-title">判定流程</h3>
              <CodeBlock code={routeDecisionCode} />
            </article>
            <article class="panel panel-warning">
              <h3 class="panel-title">安全与保留规则</h3>
              <ul class="warning-list">
                <li>
                  <code class="inline-code">/_fluxion/*</code> 是系统保留前缀，优先级最高。
                </li>
                <li>路径包含非法段或解码失败时，会直接返回 404。</li>
                <li>
                  <code class="inline-code">.mjs</code> 文件不会被当静态资源直接下载。
                </li>
                <li>
                  <code class="inline-code">_</code> 前缀目录即使存在文件，也不会暴露路由。
                </li>
              </ul>
            </article>
          </div>
        </Section>

        <Section
          id="handler"
          title="动态加载与热更新"
          lead="Fluxion 按 mtime + size 识别版本，避免重启进程。"
        >
          <div class="grid-two">
            <article class="panel">
              <h3 class="panel-title">Handler 写法</h3>
              <CodeBlock code={handlerCode} />
            </article>
            <article class="panel panel-positive">
              <h3 class="panel-title">缓存机制</h3>
              <CodeBlock code={cacheCode} />
            </article>
          </div>
        </Section>

        <Section
          id="meta-api"
          title="元接口（Meta API）"
          lead="用于观测路由、健康检查和上传部署。"
        >
          <div class="grid-two">
            <article class="panel">
              <h3 class="panel-title">GET /_fluxion/routes</h3>
              <p class="panel-note">返回当前用于 diff 的完整快照对象。</p>
              <CodeBlock code={metaRoutesCode} />
            </article>
            <article class="panel">
              <h3 class="panel-title">GET /_fluxion/healthz</h3>
              <p class="panel-note">健康检查接口，返回 ok 与当前时间戳。</p>
              <CodeBlock code={healthzCode} />
            </article>
          </div>
        </Section>

        <Section
          id="upload"
          title="上传接口与解压判定"
          lead="POST /_fluxion/upload 用于在线发布 tar 包，不支持 zip。"
        >
          <div class="grid-two">
            <article class="panel">
              <h3 class="panel-title">调用示例</h3>
              <CodeBlock code={uploadCode} />
              <p class="panel-note">
                文件名可通过 query 参数 <code class="inline-code">filename</code> 或请求头
                <code class="inline-code">x-fluxion-filename</code> 提供。
              </p>
            </article>
            <article class="panel">
              <h3 class="panel-title">解压判定规则</h3>
              <CodeBlock code={uploadRuleCode} />
            </article>
          </div>
        </Section>

        <Section
          id="examples"
          title="访问示例速查"
          lead="下面是最常见的路径到行为映射，便于快速排错。"
        >
          <div class="panel">
            <CodeBlock code={requestMapCode} />
          </div>
        </Section>
      </main>

      <footer class="footer">
        <p>Fluxion 文档页（kt.js + Vite）</p>
      </footer>
    </div>
  );
}
