#!/usr/bin/env node
// Launcher for the MCP server, and the reason it exists is the plugin install path.
//
// `dist/` is a build artifact and is gitignored, so a plugin installed straight from the git
// source has no `dist/src/mcp.js`. Pointing `plugin.json` at that path directly means the host
// reports ERR_MODULE_NOT_FOUND with a path inside its own plugin cache, which tells the user
// nothing about what to do. This says what is missing and how to fix it, then exits.
//
// It does not build on the user's behalf. An MCP server that runs `npm install` the first time a
// host starts it is a surprise with a network fetch in it, and the host starts servers without
// asking.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const built = join(root, "dist", "src", "mcp.js");

if (!existsSync(built)) {
  const installed = existsSync(join(root, "node_modules"));
  process.stderr.write(
    [
      "adhd: the MCP server is not built.",
      "",
      `  ${built}`,
      "",
      installed
        ? `  Dependencies are present. Run:  npm run build   (in ${root})`
        : `  Run:  npm install && npm run build   (in ${root})`,
      "",
      "  The /adhd skill and the branch, critic and deepen agents do not need this build.",
      "  Only the MCP server does, and only for hosts other than Claude Code.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

await import(pathToFileURL(built).href);
