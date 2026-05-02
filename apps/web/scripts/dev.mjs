import { createReadStream } from "node:fs";
import { readFile, stat, watch } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 4173);
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = fileURLToPath(new URL("../dist", import.meta.url));
const watchTargets = ["src", "public", "index.html"].map((target) => join(root, target));

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
]);

const reloadClients = new Set();
let buildInProgress = false;
let rebuildQueued = false;
let debounceTimer;

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: true,
      stdio: "inherit",
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });

const build = async (reason = "initial") => {
  if (buildInProgress) {
    rebuildQueued = true;
    return;
  }

  buildInProgress = true;
  console.log(`[web] ${reason} build started`);

  try {
    await run("node", ["scripts/clean.mjs"]);
    await run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"]);
    await run("node", ["scripts/build.mjs"]);
    console.log("[web] build complete");
    broadcastReload();
  } catch (error) {
    console.error(`[web] build failed: ${error.message}`);
  } finally {
    buildInProgress = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      void build("queued");
    }
  }
};

const broadcastReload = () => {
  for (const response of reloadClients) {
    response.write("event: reload\ndata: now\n\n");
  }
};

const reloadScript = `
<script type="module">
  const source = new EventSource("/__pineapple-web/reload");
  source.addEventListener("reload", () => window.location.reload());
</script>`;

const serveIndex = async (response) => {
  const html = await readFile(join(dist, "index.html"), "utf8");
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html.replace("</body>", `${reloadScript}\n  </body>`));
};

const sendFile = (request, response, filePath, file) => {
  const contentType = contentTypes.get(extname(filePath)) ?? "application/octet-stream";
  const range = request.headers.range;

  if (!range) {
    response.setHeader("content-type", contentType);
    response.setHeader("content-length", file.size);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { "content-range": `bytes */${file.size}` });
    response.end();
    return;
  }

  const requestedStart = match[1] === "" ? 0 : Number(match[1]);
  const requestedEnd = match[2] === "" ? file.size - 1 : Number(match[2]);
  const start = Math.max(0, requestedStart);
  const end = Math.min(file.size - 1, requestedEnd);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    response.writeHead(416, { "content-range": `bytes */${file.size}` });
    response.end();
    return;
  }

  response.writeHead(206, {
    "accept-ranges": "bytes",
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${file.size}`,
    "content-type": contentType,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath, { start, end }).pipe(response);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/__pineapple-web/reload") {
    response.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    });
    response.write("\n");
    reloadClients.add(response);
    request.once("close", () => reloadClients.delete(response));
    return;
  }

  const requestedPath =
    url.pathname === "/"
      ? "index.html"
      : normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(dist, requestedPath);

  try {
    const file = await stat(filePath);
    if (!file.isFile()) {
      throw new Error("Not a file");
    }

    if (requestedPath === "index.html") {
      await serveIndex(response);
      return;
    }

    sendFile(request, response, filePath, file);
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
});

const scheduleBuild = (changedPath) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const label = changedPath ? relative(root, changedPath) : "file change";
    void build(label);
  }, 100);
};

const watchRecursively = async (target) => {
  const targetStat = await stat(target);

  if (targetStat.isFile()) {
    const watcher = watch(target);
    for await (const event of watcher) {
      scheduleBuild(event.filename ? join(root, String(event.filename)) : target);
    }
    return;
  }

  const watcher = watch(target, { recursive: true });
  for await (const event of watcher) {
    scheduleBuild(event.filename ? join(target, String(event.filename)) : target);
  }
};

server.listen(port, async () => {
  await build();
  console.log(`[web] watching ${watchTargets.map((target) => relative(root, target)).join(", ")}`);
  console.log(`Pineapple Agent web dev server: http://127.0.0.1:${port}`);

  for (const target of watchTargets) {
    void watchRecursively(target);
  }
});
