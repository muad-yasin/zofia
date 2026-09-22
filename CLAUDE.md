# CLAUDE.md

Zofia is the successor to Sophi-A: a Linux AppImage GUI that gives one command-and-control (C&C)
overview of several Claude Code terminal sessions running on the owner's own Claude Code
subscription. Private until the open-source release planned for later this year.

## Start here

1. Read this file, then `HANDOFF.md` (the build handoff from the council plan), then `PLAN.md`.
   `BOARD.md` is the debate record behind the plan. Read it when you need to know why something
   was decided or what was disputed.
2. Build in the order `HANDOFF.md` gives, one item at a time. Each item has an acceptance test.
   An item is done only when that test passes. Commit it and push it.
3. **The owner's spec below is binding and outranks the plan.** If `PLAN.md` or `HANDOFF.md`
   contradicts it, follow the spec and say so in chat. Don't silently pick the plan's version.

## Owner's spec (Muad, handwritten 2026-09-22, verbatim)

> What Muad wants from this new project: a linux .appimage GUI that essentially runs multiple Claude Code terminal sessions, through a Claude Code subscription. It is OK if the setup requires to manually open Claude Code in several terminals on my linux machine, to then have the GUI as a better C&C overview of what the several sessions are doing.
> What I have currently planned in my head: the screen gets cut into 4 corners, with a big navigation bar / menu bar at the top, and the C&C seat being in the middle of the screen, but never reaching too much into the visual portion of the 4 other sessions' part of the screen. Essentially 4 Claude Code sessions, and one extra Claude Code session in the middle of the screen, where I can chat with the C&C session but also see what the other sessions are doing, when they were last active, what their current Claude Code statusline says about model, effort, usage%, reset timer for 5h limit, used context in %. As well see what the Claude Code session is currently doing, thinking, working, building, token spending and the "XYZ for 49s . done XX:YY" things that Claude Code displays. And I want to later release it as open source where people can use other provider token subscriptions, or even use local LLM's for everything if they want to.

## Rules that are not style preferences

- **Privacy is a hard requirement.** Zofia reads other sessions' state on the owner's machine.
  Nothing it reads leaves the machine: no telemetry, no analytics, and no network calls except the
  ones the owner's own Claude Code sessions already make.
- **Stay within Anthropic's terms.** The plan leaves open whether a third-party GUI may drive or
  observe Claude Code sessions on a consumer subscription. Observing sessions the owner opened
  himself is the default. Anything that automates the subscription (injecting input, spawning
  sessions on his behalf, scraping auth) needs his explicit go first.
- **No efficacy claims** in any README, page or doc until something is actually measured.
- **Model and lab rules carry over from THCMCP:** no xAI/Grok anywhere. Kimi K3 never sits on a
  panel that is supposed to be independent. The model that builds something never grades it.
- **Ideas are free to study; code and prose are never copied.** Never port code from a
  differently-licensed project.
- **Never delete files without asking.** Never commit secrets, keys, `.env` files, or any
  session transcript or run output. Those contain the owner's private work.
- **Branch convention is `master`.** Commit at a finished, tested item, and push each one.
- **Human-stop gates are never skipped:** playtests, spend limits and legal review.

## Context

- The predecessor and the council engine are separate repos: Sophi-A (`~/Projects/sophi-a`), and
  THCMCP (`~/Projects/THCMCP`), whose `src/chain.js` is canonical. Read them for precedent. Don't
  edit them from here.
- The owner's board is `~/Projects/FOCUS.md`.
