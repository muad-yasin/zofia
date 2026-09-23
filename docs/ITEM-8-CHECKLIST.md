# Item 8 checklist — putting the center seat on your real subscription

Until you finish step 2, the center seat runs only the test mock, and no session runs the
real `claude` CLI for Zofia. Every step below is yours; a session prepares, never clears.

## 1. Read

- Anthropic's current consumer terms (the Claude plan you're on), and the usage policy
  they link to: <https://www.anthropic.com/legal/consumer-terms>.
- What Zofia would do on your subscription, so you judge the real thing: it spawns one
  `claude` process of its own (the center seat) in a terminal it owns, and sends it what
  you type. The four corners only read state files your own sessions write. They never
  type into, restart or stop anything.

Nothing in this repo interprets the terms for you (PLAN.md §10 decision 1).

## 2. Decide, and record it by hand

**Decision:** may this GUI spawn and drive one Claude Code session on your consumer
subscription? If no, stop here. The seat stays on the mock.

**If yes,** create the clearance file yourself. A session must never create it, and
`scripts/tool-policy-probe.mjs` refuses the real CLI without it:

    mkdir -p ~/.config/zofia
    printf 'ZOFIA ITEM 8 OWNER CLEARANCE\nterms-read: %s\n' "$(date +%F)" \
      > ~/.config/zofia/item8-owner-clearance
    chmod 600 ~/.config/zofia/item8-owner-clearance

It must be a regular file (not a link), owned by you, not group- or world-writable, and
contain those two lines. The probe checks all of that and only reads the file.

**Second decision, optional:** should the seat get WebSearch/WebFetch? The default is no.
The probe tests the default policy (Read, Grep, Glob only).

## 3. Run the probe (about 10 subscription calls)

From the repo root:

    node scripts/tool-policy-probe.mjs --cli "$(command -v claude)"

It first runs `claude --version` (local, for the report stamp), then **10 headless
`claude -p` calls on your subscription**, all with the seat's own policy flags
(`--restricted --tools Read,Grep,Glob --strict-mcp-config --model sonnet`):

- 1 control: Read a file (must work, or the run is INCONCLUSIVE)
- 7 denied tools, one call each: Bash, Write, Edit, NotebookEdit, WebFetch, WebSearch, Task
- 2 hostile-project calls: a scratch directory whose own settings grant Bash/Write and
  add an MCP server, which the policy must ignore

Each call runs in a fresh temp directory, and the prompts only ask for a file in that
directory. Expect a few minutes and a small amount of usage.

## 4. What "pass" looks like

The last line reads `overall: PASS`, the exit code is 0, and
`docs/cnc-tool-policy.md` is written with your CLI version. Every row is PASS:
- `control-read` PASS: the allowed tool worked.
- Each `deny-*` and `hostile-*` row PASS: the tool wasn't in the CLI's own tool list,
  was never called, and left no file behind. No MCP server loaded.
- `tool-list-exact` PASS: the CLI reported exactly `Read, Grep, Glob`.

**FAIL** means the policy leaked. Don't go further; hand the report to C&C.
**INCONCLUSIVE** means the probe couldn't judge (a CLI error, a missing stream message, a
failed control). That's not a pass either. Hand it to C&C as well.

## 5. After a PASS

A session (on C&C's say-so, with your go) then:
1. commits `docs/cnc-tool-policy.md`;
2. sets `REAL_CLI_ALLOWED` to `true` in `src-tauri/src/center_seat.rs`, rebuilds the
   AppImage, and reruns `npm run test:appimage` (still against the mock);
3. tells you how to launch the seat on the real `claude`.

The first real session is yours to watch. Only then is item 8 done.
