import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 4173);
const dist = fileURLToPath(new URL("../dist", import.meta.url));

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
]);

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

    sendFile(request, response, filePath, file);
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Pineapple Agent web demo: http://127.0.0.1:${port}`);
});
