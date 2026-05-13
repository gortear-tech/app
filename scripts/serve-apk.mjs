import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";

const port = Number(process.env.PORT ?? process.argv[2] ?? 8787);
const distDir = resolve(process.cwd(), "dist");

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
  const filename = basename(pathname === "/" ? "FBmaniaco-real-android.apk" : pathname);
  const filePath = join(distDir, filename);

  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("APK no encontrada");
    return;
  }

  const stat = statSync(filePath);
  response.writeHead(200, {
    "content-type": "application/vnd.android.package-archive",
    "content-length": stat.size,
    "content-disposition": `attachment; filename="${filename}"`
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`apk-server http://127.0.0.1:${port}`);
});
