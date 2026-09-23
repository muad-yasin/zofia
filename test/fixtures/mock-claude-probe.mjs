#!/usr/bin/env node
// Deterministic fake of `claude -p ... --output-format stream-json` for the item 8
// tool-policy probe (scripts/tool-policy-probe.mjs). It is NOT a model of Claude Code's
// behaviour, only of the two things the probe reads: the `system/init` message's tool and
// MCP-server lists, and the effect of a tool the prompt asks for.
//
// Honours `--tools` (absent = every tool, so a dropped flag shows up as a leak) and
// `--strict-mcp-config` (absent = the workdir's .mcp.json servers load). With
// MOCK_PROBE_LEAK=1 it ignores both and performs every requested effect: the probe's
// self-test uses that to prove it reports FAIL on a leak, not only PASS on a clean run.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ALL_TOOLS = ["Bash", "Edit", "Glob", "Grep", "NotebookEdit", "Read", "Task", "WebFetch", "WebSearch", "Write"];
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const leak = process.env.MOCK_PROBE_LEAK === "1";
const prompt = flag("-p") ?? "";
const model = flag("--model") ?? "default";

const tools = leak || !argv.includes("--tools") ? ALL_TOOLS : flag("--tools").split(",").filter(Boolean);
let mcpServers = [];
if ((leak || !argv.includes("--strict-mcp-config")) && existsSync(".mcp.json")) {
  const servers = JSON.parse(readFileSync(".mcp.json", "utf8")).mcpServers ?? {};
  mcpServers = Object.keys(servers).map((name) => ({ name, status: "connected" }));
  for (const name of Object.keys(servers)) tools.push(`mcp__${name}__probe`);
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
emit({ type: "system", subtype: "init", model, tools, mcp_servers: mcpServers, cwd: process.cwd() });

// The probe's prompts carry a machine-readable line: PROBE tool=<T> path=<p> nonce=<n>
const m = /PROBE tool=(\S+) path=(\S+) nonce=(\S+)/.exec(prompt);
let result = "no probe line";
if (m) {
  const [, tool, path, nonce] = m;
  if (!tools.includes(tool)) {
    result = `I don't have a ${tool} tool.`;
  } else {
    emit({ type: "assistant", message: { content: [{ type: "tool_use", name: tool, input: { path } }] } });
    if (tool === "Read") result = readFileSync(path, "utf8");
    else if (tool === "Write") writeFileSync(path, nonce);
    else if (tool === "Edit") writeFileSync(path, readFileSync(path, "utf8").replace("ORIGINAL", nonce));
    else if (tool === "Bash") execFileSync("touch", [path]);
    else if (tool.startsWith("mcp__")) writeFileSync(path, nonce);
    else writeFileSync(path, nonce); // NotebookEdit/Task/WebFetch/WebSearch: any effect counts
    if (tool !== "Read") result = "done";
  }
}
emit({ type: "result", subtype: "success", is_error: false, result });
