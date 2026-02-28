import { CodeBlock } from './CodeBlock.js';
import { Section } from './Section.js';

const introCode = `pnpm install
pnpm run doc:dev`;

const moduleTreeCode = `dynamicDirectory/
└── aaa/
    ├── server/
    │   ├── index.js
    │   └── bb/
    │       ├── cc/index.js   # priority 1
    │       └── cc.js         # priority 2
    └── web/
        ├── index.html
        └── ...`;

const handlerCode = `// dynamicDirectory/aaa/server/bb/cc/index.js
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, path: req.url }));
}`;

const uploadCode = `curl -X POST \
  'http://127.0.0.1:3000/_fluxion/upload?filename=my-module.tar.gz' \
  -H 'content-type: application/octet-stream' \
  --data-binary @./my-module.tar.gz`;

const routesCode = `curl 'http://127.0.0.1:3000/_fluxion/routes'`;

export function App() {
  return (
    <div class="doc-page">
      <div class="bg-glow bg-glow-left" />
      <div class="bg-glow bg-glow-right" />

      <header class="hero">
        <p class="eyebrow">Fluxion Meta Server Guide</p>
        <h1 class="hero-title">Build dynamic route-driven modules in plain Node.js</h1>
        <p class="hero-copy">
          Fluxion watches your module directory, mounts routes automatically, hot-reloads handlers by
          file mtime/size, and provides meta APIs for route snapshots and package uploads.
        </p>
        <div class="hero-actions">
          <a href="#quick-start" class="button button-primary">
            Quick Start
          </a>
          <a href="#meta-api" class="button button-ghost">
            Meta API
          </a>
        </div>
      </header>

      <nav class="toc">
        <a href="#quick-start">Quick Start</a>
        <a href="#module-layout">Module Layout</a>
        <a href="#route-resolution">Route Resolution</a>
        <a href="#lifecycle">Module Lifecycle</a>
        <a href="#meta-api">Meta API</a>
        <a href="#upload-rules">Upload Rules</a>
      </nav>

      <main class="content">
        <Section
          id="quick-start"
          title="Quick Start"
          lead="Use this folder as a standalone docs app powered by Vite + kt.js."
        >
          <div class="panel">
            <ul class="check-list">
              <li>Install workspace dependencies once with pnpm.</li>
              <li>Run Vite with the local config in document/vite.config.ts.</li>
              <li>Edit document/src/view to extend this page.</li>
            </ul>
            <CodeBlock code={introCode} />
          </div>
        </Section>

        <Section
          id="module-layout"
          title="Module Layout"
          lead="Each first-level folder under dynamicDirectory is treated as one module."
        >
          <div class="panel">
            <CodeBlock code={moduleTreeCode} />
            <p class="panel-note">
              Fluxion mounts routes from the module name. For module aaa, requests begin with /aaa/...
              and resolve into files inside aaa/server/.
            </p>
          </div>
        </Section>

        <Section
          id="route-resolution"
          title="Route Resolution"
          lead="Fluxion maps request path segments to handler files and always reads default exports."
        >
          <div class="grid-two">
            <article class="panel">
              <h3 class="panel-title">Resolution Order</h3>
              <ol class="ordered-list">
                <li>Incoming request: /aaa/bb/cc</li>
                <li>Target module: aaa</li>
                <li>Try aaa/server/bb/cc/index.js first</li>
                <li>If not found, try aaa/server/bb/cc.js</li>
                <li>Load default export as (req, res) handler</li>
              </ol>
            </article>

            <article class="panel">
              <h3 class="panel-title">Handler Example</h3>
              <CodeBlock code={handlerCode} />
            </article>
          </div>
        </Section>

        <Section
          id="lifecycle"
          title="Module Lifecycle"
          lead="No restart needed. Fluxion watches dynamicDirectory and diffs modules automatically."
        >
          <div class="panel">
            <div class="timeline">
              <p class="timeline-item">
                <span class="timeline-key">Startup</span> Scan all module folders and mount routes
                immediately.
              </p>
              <p class="timeline-item">
                <span class="timeline-key">Add module</span> New folder appears and routes are
                registered.
              </p>
              <p class="timeline-item">
                <span class="timeline-key">Remove module</span> Folder removed and routes are
                unregistered.
              </p>
              <p class="timeline-item">
                <span class="timeline-key">Edit handler</span> mtime + size changes and next request
                loads the new handler version.
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="meta-api"
          title="Meta API"
          lead="Fluxion includes built-in control endpoints for introspection and deployment."
        >
          <div class="grid-two">
            <article class="panel">
              <h3 class="panel-title">GET /_fluxion/routes</h3>
              <p class="panel-note">Returns route snapshot for diff and tooling.</p>
              <CodeBlock code={routesCode} />
            </article>
            <article class="panel">
              <h3 class="panel-title">POST /_fluxion/upload</h3>
              <p class="panel-note">Upload .tar / .tar.gz / .tgz as binary body.</p>
              <CodeBlock code={uploadCode} />
            </article>
          </div>
        </Section>

        <Section
          id="upload-rules"
          title="Upload Rules"
          lead="Archive extraction is validated before installation into dynamicDirectory."
        >
          <div class="grid-two">
            <article class="panel panel-positive">
              <h3 class="panel-title">Accepted</h3>
              <ul class="check-list">
                <li>Top-level has server/ and web/ folders.</li>
                <li>Single top-level folder that contains server/ and web/ folders.</li>
              </ul>
            </article>
            <article class="panel panel-warning">
              <h3 class="panel-title">Rejected (HTTP 400)</h3>
              <ul class="warning-list">
                <li>Unsupported extension (for example .zip).</li>
                <li>Missing server/ or web/ folders.</li>
                <li>Unexpected multi-root archive layout.</li>
              </ul>
            </article>
          </div>
        </Section>
      </main>

      <footer class="footer">
        <p>Fluxion documentation page built with kt.js and Vite.</p>
      </footer>
    </div>
  );
}
