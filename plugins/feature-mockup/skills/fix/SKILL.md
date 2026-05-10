---
name: fix
description: "Use this to apply UI/UX + interaction fixes to a generated prototype, either from /feature-mockup:verify findings or from user-described issues. Always asks the user to confirm scope and choices before editing. Invoke for prompts like 'fix the prototype', 'apply verify fixes', '/feature-mockup:fix <feature>'."
argument-hint: "<feature-name> [optional: free-form fix description]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# Feature Mockup — Fix

Apply targeted fixes to a generated prototype. Two input sources:
1. The `verify` skill's report at `{featureDir}/.verify/report.md` (preferred)
2. User-described issues in the command arguments or a follow-up answer

**Core principle: confirm with the user before each batch of changes.** Never silently rewrite the prototype.

## Step 1 — Load config + resolve feature dir

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:init` first."

Extract `outputDir`, `workingLanguage`, and `theme.imported` (true/false).

`$ARGUMENTS` parsing:
- First word = feature name. Resolve `featureDir = {outputDir}/{feature}`.
- Rest of `$ARGUMENTS` = optional free-form fix description.

If `featureDir` missing, stop.

## Step 2 — Identify fix sources

Check what's available:

| Source | Path | Use when |
|---|---|---|
| Verify report | `{featureDir}/.verify/report.md` | exists |
| User free-form description | `$ARGUMENTS` after feature name | user passed text |
| Brand-new request | (neither) | ask user |

Use `AskUserQuestion`:

> "What should I fix?"

Options (only show ones that apply):
1. **Apply all P0 + P1 fixes from the verify report** (if report exists)
2. **Apply only P0 (blocking) fixes** (if report exists)
3. **Apply specific issues I'll describe** — opens a follow-up prompt
4. **Both verify report + my own issues**

If no verify report exists, suggest running `/feature-mockup:verify {feature}` first OR collect the user's free-form description.

## Step 3 — Build the fix list

### When verify report is the source

Read `{featureDir}/.verify/report.md`. Extract gaps from the "Gap list" section. Filter by user's chosen priority (P0 only / P0+P1 / all).

Each gap should have:
- `id` — short tag like `gap-grid-col-04`
- `priority` — P0 / P1 / P2
- `region` — header / sidebar / filter / grid / modal / etc
- `description` — what's wrong
- `recommendedFix` — one-line action

### When user free-form is the source

Parse the user's description. For each issue identified, ask follow-up if vague:

| Vague pattern | Clarification to ask |
|---|---|
| "fix the colors" | "Which element specifically? And what color (provide hex or describe)?" |
| "make it more like {real admin}" | "Do you have a screenshot to reference? Or which specific aspect?" |
| "fix the form" | "Which field/button is broken? What's the expected behavior?" |
| "add the missing field" | "Field name + label + type + required?" |

## Step 4 — Confirm scope with user (CRITICAL STEP)

Print the parsed fix list with priority tags:

```
I plan to apply the following fixes:

  [P0] gap-grid-col-04
       Region: data grid
       Issue:  Missing 'Region' column (4th in the real admin, absent in prototype)
       Fix:    Add column with header 'Region', binding to row.regionName, width 120px

  [P0] gap-modal-validation
       Region: edit modal
       Issue:  Form submits without validating hotelCode pattern
       Fix:    Add HTML5 pattern + JS validator from validators.json

  [P1] gap-toolbar-buttons-3-of-8
       Region: toolbar
       Issue:  3 of 8 toolbar buttons missing (Recommendation, Add Region, Delete Region)
       Fix:    Add 3 buttons with matching icons + handlers wired from events.json

  [P1] gap-status-color
       Region: data grid
       Issue:  Status 'Cancelled' rendered as orange, real admin uses red
       Fix:    Change .status-cancelled color from #f59e0b → #dc2626

  [P2] gap-spacing-tight
       Region: filter area
       Issue:  Filter row gap is 16px, real admin uses 12px
       Fix:    Change .filter-grid gap from 1rem → 0.75rem
```

Use `AskUserQuestion`:

> "Apply all 5 fixes?"

Options:
1. **Apply all** (Recommended)
2. **Apply only P0** (skip P1+P2)
3. **Skip specific items** — ask user which IDs to skip
4. **Cancel** — exit without changes

## Step 5 — Apply theme + UI/UX rules check (before editing)

For each fix, validate against design system rules:

| Rule | Check | Fail action |
|---|---|---|
| Theme tokens are mandatory when `theme.imported === true` | Fix should NOT introduce hardcoded colors outside tokens | Ask user: "This fix uses hardcoded #dc2626 instead of `var(--color-danger)`. Use the token instead?" |
| Lucide icons only (no emoji) | Fix should not introduce emoji characters | Ask user: "Fix introduces 🔴 emoji. Replace with `<i data-lucide='circle-fill'>`?" |
| Maintain admin density (font-size-xs ≈ 12px) | Fix should not balloon paddings/font sizes | Ask user: "Fix sets font-size: 16px which breaks admin density. Use var(--font-size-xs)?" |
| Source-derived class names (when source-copy/ exists) | Fix should reuse existing classes, not invent new ones | Ask user: "Class .my-new-button is invented. Existing class `.btn-primary` matches — use that?" |

When user explicitly says "I want it different from the rule" (e.g. "yes, use the bigger font for this one specific button"), respect that — but log the deviation in the final report.

## Step 6 — Execute fixes

For each confirmed fix, do the minimum edit needed:

### UI/visual fixes
- Use `Edit` to change CSS values, class attributes, HTML structure
- For colors: prefer CSS variable if theme imported; literal hex otherwise
- For spacing: use rem/px consistent with existing values

### Content fixes (missing labels / fields / columns)
- Read the source-copy/ file the gap references
- Copy the exact label/structure into the prototype HTML
- For tables: insert `<th>` + `<td>` at the right index
- For forms: insert `<label>` + `<input>` with id/name matching source

### Interaction fixes
- Validation: read validators.json `<route>.<field>` rules → emit JS validator + HTML5 attributes
- Event handlers: read events.json `<route>.handlers.<name>.actions` → emit vanilla JS function with action chain (toast / dialog-close / store mutation)
- Form binding: ensure `id`/`for`/`name` attribute consistency

### Theme fixes
- When user explicitly opts to override theme tokens, edit `{themeDir}/theme.css` and add an override variable
- Note this in the final report

After each batch of edits, re-read the changed file briefly to verify (only when the edit was complex, not for simple value swaps).

## Step 7 — Smoke test

Run a quick sanity check on the prototype:

1. **HTML validity**: scan for unclosed tags via regex (`<(\w+)[^>]*>` paired with `</\1>`). Surface obvious mismatches.
2. **JS syntax**: extract inline `<script>` blocks, check for `Uncaught` patterns from common typos.
3. **Class references**: every class used in the HTML should exist in the imported theme.css OR the prototype's own style block.
4. **No emoji introduced**: grep for `[\u{1F300}-\u{1FAFF}]` — fail if any.

When any check fails, print the issue and ask:
> "Smoke test found {N} issues after fixes. Show details and let me try to repair?"

## Step 8 — Re-verify suggestion

After applying fixes, prompt the user:

> "Fixes applied. Run `/feature-mockup:verify {feature}` to confirm the issues are resolved?"

Use `AskUserQuestion`:
1. **Yes, run verify now**
2. **No, I'll review manually first**
3. **Open the prototype** (run `/feature-mockup:preview {feature}` first)

## Step 9 — Final report

Write `{featureDir}/.verify/fix-log-{ISO-date}.md`:

```markdown
# Fix log — {date}

Applied fixes:
  - [P0] gap-grid-col-04: Added Region column at index 4 (file: index.html)
  - [P0] gap-modal-validation: Wired hotelCode pattern validator (files: index.html, validators inline)
  - [P1] gap-toolbar-buttons-3-of-8: Added 3 buttons (file: index.html)
  - [P1] gap-status-color: Changed status-cancelled to var(--color-danger) (file: theme.css override)

Skipped (per user request):
  - [P2] gap-spacing-tight: User wants the looser 16px spacing

Theme rule deviations (per user request):
  - gap-status-color: Used hardcoded #dc2626 instead of var() because user said the token was wrong shade

Smoke test: PASS (0 issues)

Files changed:
  - {featureDir}/index.html (5 edits)
  - {featureDir}/styles.css (1 edit)
```

Print the report path so user can audit.

## Edge cases

- **Conflicting fixes**: when 2 gaps want to change the same line differently, show user both options and ask.
- **Fix introduces a new gap** (e.g. adding column makes table overflow): note in fix log; suggest re-verify.
- **User asks to fix something the brief originally said NOT to do**: ask explicitly: "The brief says 'no Booking ID column'. You want to add it anyway?"
- **Theme not imported**: skip theme-token rules; use literal values.
- **Fix requires source data we don't have**: ask user: "I need the actual {field} options to add this dropdown. Provide a list, or extract from real admin via /feature-mockup:verify first?"
- **Mass rewrite request** ("redo the entire grid"): refuse, ask user to break into specific issues OR run /feature-mockup:make again with updated brief.

## Done

End with:
1. Fix-log path
2. Suggested next command (re-verify or preview)
3. List of files changed (so user knows what to review)
