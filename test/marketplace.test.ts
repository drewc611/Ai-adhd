import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./helpers.js";

/**
 * Distribution metadata, checked against itself.
 *
 * Four files carry the version and the identity, and they disagree silently: `package.json` is
 * what npm serves, `server.json` is what the MCP Registry records, `plugin.json` is what a host
 * loads, and `marketplace.json` is what a user sees before installing. A release where three
 * agree and one does not is the kind nobody can reproduce, and the registries have no unpublish
 * window worth relying on.
 */

const ROOT = cfg.root;
const read = (...p: string[]) => JSON.parse(readFileSync(join(ROOT, ...p), "utf8")) as Record<string, any>;

const pkg = read("package.json");
const server = read("server.json");
const plugin = read(".claude-plugin", "plugin.json");
const marketplace = read(".claude-plugin", "marketplace.json");

/** Claude Code ships its own marketplace pre-registered and refuses these names to third parties. */
const RESERVED = [
  "claude-code-marketplace",
  "claude-plugins-official",
  "anthropic-plugins",
  "claude-for-legal",
  "claude-for-financial-services",
];

test("the marketplace manifest has what a host requires and no reserved name", () => {
  assert.match(String(marketplace["name"]), /^[a-z0-9]+(-[a-z0-9]+)*$/, "marketplace name must be kebab-case");
  assert.ok(!RESERVED.includes(String(marketplace["name"])), `${marketplace["name"]} is reserved for Anthropic's own marketplace`);
  assert.ok(marketplace["owner"]?.["name"], "no owner.name, which is required");
  assert.ok(Array.isArray(marketplace["plugins"]) && marketplace["plugins"].length > 0, "no plugins listed");
  for (const p of marketplace["plugins"]) {
    assert.match(String(p["name"]), /^[a-z0-9]+(-[a-z0-9]+)*$/, `${p["name"]} is not kebab-case`);
    assert.ok(p["source"], `${p["name"]} has no source`);
  }
});

test("every plugin source in the marketplace resolves to a real plugin", () => {
  for (const p of marketplace["plugins"]) {
    if (typeof p["source"] !== "string") continue; // object sources point off-repo by design
    const manifest = join(ROOT, p["source"], ".claude-plugin", "plugin.json");
    assert.ok(existsSync(manifest), `${p["name"]} sources ${p["source"]}, which holds no plugin.json`);
  }
});

test("the marketplace entry describes the plugin it actually installs", () => {
  const entry = marketplace["plugins"].find((p: Record<string, unknown>) => p["name"] === plugin["name"]);
  assert.ok(entry, `marketplace.json lists no entry named ${plugin["name"]}`);
  // The entry name is what `/plugin install` and `enabledPlugins` key on, so a mismatch here
  // renames the plugin out from under anyone who already enabled it.
  assert.equal(entry["version"], plugin["version"], "the marketplace advertises a version the plugin does not carry");
  assert.equal(entry["license"], plugin["license"]);
  assert.equal(entry["repository"], plugin["repository"]);
});

test("server.json claims a namespace this repository can prove it owns", () => {
  assert.equal(server["$schema"], "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  const owner = (pkg["repository"]?.["url"] ?? "").match(/github\.com\/([^/]+)\//)?.[1];
  assert.ok(owner, "package.json has no parseable GitHub repository url");
  // `io.github.<owner>/*` is verified from the release workflow's own OIDC identity. Claiming a
  // namespace the workflow cannot prove fails at publish time with an auth error rather than a
  // naming one, which is a slow way to learn this.
  assert.match(String(server["name"]), new RegExp(`^io\\.github\\.${owner}/`), `${server["name"]} is not under io.github.${owner}/`);
});

test("the four manifests agree on version and identity", () => {
  assert.equal(server["version"], pkg["version"], "server.json and package.json disagree on version");
  assert.equal(server["packages"][0]["version"], pkg["version"], "the registry package version is not the package version");
  assert.equal(plugin["version"], pkg["version"], "plugin.json and package.json disagree on version");
  assert.equal(server["packages"][0]["identifier"], pkg["name"], "server.json names a different npm package");
  // The registry proves package ownership by reading `mcpName` out of the published package.json.
  // Without it the publish is rejected, and the rejection names a field rather than the reason.
  assert.equal(pkg["mcpName"], server["name"], "package.json mcpName must match the server name being claimed");
});

test("the published npm name is not one that is already taken", () => {
  // `adhd` is a 2022 stub at 0.0.0 on npm. It resolves, so `npm publish` would fail with a 403
  // that reads like a permissions problem. Backlog item 72 called this the owner's decision; the
  // registry made it for us.
  assert.notEqual(pkg["name"], "adhd", "npm serves `adhd` already; publishing under it is a 403");
  assert.match(String(pkg["name"]), /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/, "not a valid npm name");
});

test("the release workflow is tag-driven, uses OIDC, and stores no registry token", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(wf, /tags: \["v\*"\]/, "the release is not driven by a version tag");
  assert.match(wf, /id-token: write/, "no OIDC permission, so the MCP Registry publish cannot authenticate");
  assert.match(wf, /mcp-publisher login github-oidc/, "the registry step falls back to a stored token");
  assert.ok(!/NPM_TOKEN\s*[:=]\s*["'][^$]/.test(wf), "a literal token in the workflow");
  // npm before the registry: the registry reads mcpName off the published package, so the reverse
  // order fails describing a missing field rather than a race.
  assert.ok(wf.indexOf("npm publish --provenance") < wf.indexOf("mcp-publisher publish"), "the registry publish runs before npm");
});
