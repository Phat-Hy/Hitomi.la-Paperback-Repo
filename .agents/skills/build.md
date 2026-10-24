---
name: build
description: Execute an approved plan into real code. Use after a plan exists and you're ready to implement.
---

# Build

## Purpose

Turn a plan into working code, following the order the `plan` skill laid
out - not improvising a different approach mid-implementation.

<HARD-GATE>
Do NOT write or modify implementation code until a plan exists and has been reviewed.
This applies regardless of perceived task simplicity - unexamined assumptions
waste the most time on "simple" tasks.
A user may explicitly override this ordering, but never a required safety,
privacy, or confirmation guard. A user may explicitly say "just code it" to skip planning for a trivial task.
</HARD-GATE>

## Core principles

- Follow the plan; if reality forces a deviation, say so and why, don't
  silently diverge.
- Write a test for logic whose correct behavior isn't obvious from reading it.
- Ask for review before considering something done.
- Never claim "done" without having actually run a check that proves it.

You can split a plan step into smaller sub-steps yourself if that helps you
work through it, as long as the end result still matches the plan.

## Make it yours

Add your own habits on top of this - always run a linter, always commit
after each small step, always re-read the diff before moving on. This skill
only covers the minimum: follow the plan, test what's unclear, get
reviewed, verify before claiming done.
