# Feature Mockup — Timeline & STATUS spec

Every feature folder has a session timeline so a BA can pick up where they left off, even days later. Two files per feature:

- `{featureDir}/.timeline.json` — append-only event log + pending tracker (machine-readable)
- `{featureDir}/STATUS.md` — human-readable summary regenerated from timeline.json on every skill run

## .timeline.json schema

```json
{
  "feature": "<feature-name>",
  "createdAt": "<ISO timestamp of /make>",
  "lastActivityAt": "<ISO timestamp of most recent event>",
  "currentPhase": "drafted | themed | previewed | verified | fixing | fixed | deployed",
  "totals": {
    "verifyRuns": 0,
    "fixRuns": 0,
    "deployRuns": 0,
    "previewRuns": 0
  },
  "pending": {
    "gaps": [
      {
        "id": "gap-grid-col-04",
        "priority": "P0",
        "region": "data grid",
        "description": "Missing 'Region' column",
        "introducedBy": "verify-2026-05-10T16:30:00Z",
        "resolvedBy": null
      }
    ],
    "notes": []
  },
  "events": [
    {
      "id": "evt-0001",
      "kind": "make",
      "ts": "2026-05-10T14:00:00Z",
      "actor": "ba",
      "summary": "Generated prototype from brief: 3 screens, html-tailwind template",
      "data": {
        "template": "html-tailwind",
        "screenCount": 3,
        "themeBranch": "real-system",
        "briefPath": "brief.json"
      }
    },
    {
      "id": "evt-0002",
      "kind": "verify",
      "ts": "2026-05-10T16:30:00Z",
      "actor": "ba",
      "summary": "Verify run 1: 3 P0 + 5 P1 + 2 P2 issues",
      "data": {
        "reportPath": ".verify/report.md",
        "referenceSource": "live-url",
        "browserBackend": "chrome-devtools-mcp",
        "p0": 3,
        "p1": 5,
        "p2": 2,
        "screenshots": [
          "reference-desktop.png",
          "prototype-desktop.png"
        ]
      }
    },
    {
      "id": "evt-0003",
      "kind": "fix",
      "ts": "2026-05-10T17:00:00Z",
      "actor": "ba",
      "summary": "Fix run 1: applied 5 fixes (3 P0 + 2 P1), skipped 1 P2",
      "data": {
        "fixLogPath": ".verify/fix-log-2026-05-10T17-00-00Z.md",
        "applied": ["gap-grid-col-04", "gap-modal-validation", "gap-toolbar-buttons-3-of-8", "gap-status-color", "gap-spacing-tight"],
        "skipped": ["gap-icon-variant"],
        "themeDeviations": []
      }
    },
    {
      "id": "evt-0004",
      "kind": "deploy",
      "ts": "2026-05-10T17:15:00Z",
      "actor": "ba",
      "summary": "Deployed to Netlify Drop",
      "data": {
        "provider": "netlify-drop",
        "url": "https://random-name-xyz.netlify.app",
        "expiresAt": "2026-05-10T18:15:00Z"
      }
    }
  ]
}
```

## Event kinds

| kind | When emitted | Data fields |
|---|---|---|
| `init` | `/feature-mockup:init` runs and creates config | `workingLanguage`, `outputDir`, `defaultTemplate` |
| `theme-import` | `/feature-mockup:ingest-theme` succeeds | `source`, `tokensCount`, `componentsCount`, `themeDir` |
| `make` | `/feature-mockup:make` succeeds | `template`, `screenCount`, `themeBranch`, `briefPath` |
| `preview` | `/feature-mockup:preview` opens browser | `url`, `framework` |
| `verify` | `/feature-mockup:verify` finishes | `reportPath`, `referenceSource`, `browserBackend`, `p0`, `p1`, `p2`, `screenshots[]` |
| `fix` | `/feature-mockup:fix` finishes | `fixLogPath`, `applied[]`, `skipped[]`, `themeDeviations[]` |
| `deploy` | `/feature-mockup:deploy` succeeds | `provider`, `url`, `expiresAt`, `providerMeta` |
| `note` | User-invoked `/feature-mockup:note` (future) | `text` |

## currentPhase derivation

After each event, recompute:

| Most recent event kind | currentPhase |
|---|---|
| `init` | `drafted` (still no /make run) |
| `theme-import` | `themed` |
| `make` | `drafted` |
| `preview` | `previewed` (only if no verify exists yet) |
| `verify` (with pending P0+P1) | `verified` |
| `verify` (no pending) | `verified` (same — clean) |
| `fix` (still pending after) | `fixing` |
| `fix` (no pending after) | `fixed` |
| `deploy` | `deployed` (terminal but reversible — re-running other skills changes phase back) |

## pending.gaps lifecycle

- Verify event creates a gap entry per finding in the report (P0/P1/P2)
- Each gap has stable `id` (kebab-case slug) — verify generates same id when same finding recurs in the SAME region
- Fix event sets `resolvedBy = "fix-<event-id>"` for each gap in its `applied[]` list
- Gaps that are skipped or never fixed remain `resolvedBy: null` → counted as pending
- A new verify run can re-introduce the same gap-id if the issue regressed; resolvedBy resets to null

## STATUS.md format

Auto-regenerated from timeline.json on every skill write. Markdown that a human can scan in 30s:

```markdown
# Status — booking-cancel-flow

**Phase:** verified · **Last activity:** 2 days ago (2026-05-10 17:00) · **Working language:** vi

## Pending (5 items)

### P0 — must fix (3)
- `gap-grid-col-04` Missing 'Region' column in data grid (from verify run 1)
- `gap-modal-validation` Form submits without validating hotelCode pattern (from verify run 1)
- `gap-status-color` Status 'Cancelled' rendered as orange, real admin uses red (from verify run 1)

### P1 — polish (2)
- `gap-toolbar-buttons-3-of-8` 3 of 8 toolbar buttons missing (from verify run 1)
- `gap-spacing-tight` Filter row gap is 16px, real admin uses 12px (from verify run 1)

## Recent activity

| When | What |
|---|---|
| 2026-05-10 17:00 | Verified run 1: 3 P0 + 5 P1 + 2 P2 issues |
| 2026-05-10 14:00 | Generated prototype from brief: 3 screens, html-tailwind |

## Suggested next step

You have 3 P0 issues to fix. Run:

```
/feature-mockup:fix booking-cancel-flow
```

Or open the verify report directly: `.verify/report.md`

## Deployments

(none yet)

## Notes

(none)
```

When phase = `deployed`, add a "Deployed URLs" section listing each deploy event's URL with provider + expiry.

When phase = `fixed` (no pending), STATUS shows green checkmark line:

```markdown
**Phase:** fixed ✓ · all P0/P1 issues resolved · ready to deploy
```

## ID conventions

- Event IDs: `evt-NNNN` zero-padded 4 digits, monotonic per feature
- Gap IDs: `gap-<region-slug>-<seq>` where seq ensures uniqueness across regions (e.g. `gap-grid-col-04`, `gap-modal-validation-01`)
- Note IDs: `note-NNNN`

## File update discipline

Every skill that writes state MUST:

1. Read `.timeline.json` (create if missing with `events: []`, `totals`, etc.)
2. Append a new event with monotonic `id`
3. Update `lastActivityAt` to event's `ts`
4. Recompute `currentPhase`
5. Recompute `totals.<kind>Runs`
6. For verify: replace `pending.gaps` with the new run's findings (preserving `resolvedBy` for unchanged gaps)
7. For fix: mark `resolvedBy` on gap IDs in `applied[]`
8. Write `.timeline.json`
9. Regenerate `STATUS.md` from current timeline state
10. Print "Status logged → STATUS.md" hint to user

## Non-goals

- Not a full audit log for compliance — events are coarse, no per-edit diff
- Not git — does not version-control prototype files; that's the user's repo
- Not multi-user — assumes one BA per feature folder. Concurrent edits will lose some events.
