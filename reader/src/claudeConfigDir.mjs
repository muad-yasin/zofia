// Where Claude Code keeps settings.json. `CLAUDE_CONFIG_DIR` relocates it (Claude Code settings
// docs); the installer used to hard-code ~/.claude, so it patched a file Claude Code never read
// for anyone who had moved it (research brief 06, 2026-09-25).
import os from "node:os";
import path from "node:path";

export function claudeConfigDir(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir ? path.resolve(dir) : path.join(os.homedir(), ".claude");
}
