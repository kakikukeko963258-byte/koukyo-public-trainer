import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";
import { cwd } from "node:process";

const root = cwd();
const port = Number(process.argv[2] || 5175);
const host = process.argv[3] || "0.0.0.0";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png"
};

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, host, () => {
  const localUrls = [`http://127.0.0.1:${port}/index.html`];
  const lanUrls = Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}/index.html`);

  console.log("Open:");
  [...localUrls, ...lanUrls].forEach((url) => console.log(`  ${url}`));
});
