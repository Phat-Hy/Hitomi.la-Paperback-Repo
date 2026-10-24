# Student Harness Kit

A trimmed-down kit for learning the basic building blocks of "harness
engineering" in agentic coding: skills, agents, hooks.

## What's in the kit

**8 skills** (`.agents/skills/*.md`): `backend-development`, `brainstorm`, `build`, `code-review`, `devops`, `frontend-development`, `plan`, `ship`.

**5 specialized agents** (`.agents/agents/*.md`, `subagent: true`): `code-reviewer`, `fullstack-developer`, `planner`, `researcher`, `tester`.

**1 hook** (`.agents/hooks.json` + `.agents/kit-hooks/*.mjs`): `guard-rails` on `PreToolUse` - blocks reading/writing sensitive files like `.env`, `.pem`, `credentials*`, and protects `.hs.json` from being edited unattended by the agent. `dev-rules-reminder` is **not wired** - Antigravity has no confirmed `UserPromptSubmit`-equivalent event.

Commands are not ported in this pass - Antigravity's workflow file path under `.agents/` is not confirmed by official docs beyond UI-driven creation, so no workflow files are shipped rather than guessing a path.

## Working rules

- Do not write or modify implementation code until a plan exists and has
  been reviewed, or the user has explicitly requested implementation
  directly. A user may say "just code it" to skip planning for a trivial
  task, but never skip a required safety, privacy, or confirmation guard.
- Follow the plan; if reality forces a deviation, say so and why, don't
  silently diverge.
- Write a test for logic whose correct behavior isn't obvious from reading
  it; never claim "done" without having actually run a check that proves it.
- Before committing, pushing, or opening a pull request, treat each as a
  separately confirmed step - never chain all three automatically.
