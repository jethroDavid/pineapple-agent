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
  [".png", "image/png"],
]);

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

    response.setHeader("content-type", contentTypes.get(extname(filePath)) ?? "application/octet-stream");
    createReadStream(filePath).pipe(response);
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Pineapple Agent web demo: http://127.0.0.1:${port}`);
});
