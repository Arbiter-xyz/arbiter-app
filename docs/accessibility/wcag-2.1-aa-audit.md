# WCAG 2.1 AA audit — worker console, buyer dashboard, leaderboard, landing

Scope: `app/index.html` (worker console), `app/dashboard.html`, `app/leaderboard.html`,
`app/admin.html`, `landing/index.html`, in English (LTR) and Arabic (RTL).

Method: manual code/markup review against every WCAG 2.1 A/AA success criterion, contrast
measurement of the design tokens, and automated axe-core scanning (now enforced in CI, see
below). Screen-reader walkthroughs follow the protocol in the last section.

## Findings and fixes

| # | SC | Where | Issue | Fix |
|---|----|-------|-------|-----|
| 1 | 1.4.1 Use of Color | Worker console, category demand ("surge") bars | Urgency conveyed only by bar colour/width | Each category now shows a text level ("High / Medium / Low demand") with a distinct border style (solid / dashed / dotted) and a worker-count tooltip |
| 2 | 1.4.3 Contrast | `--muted` text (`#75758a` on `#f7f7fb`, ≈4.3:1) | Below 4.5:1 for small text | Darkened to `#5c5c70` (≈6.3:1) |
| 3 | 1.4.3 Contrast | Status badges (resolved / refunded / pending) | Green/orange/violet text on 20% tint ≈3:1 | Darker text colours, ≥4.5:1 |
| 4 | 1.3.1 / 4.1.2 | Answer input, backup secret, stake amount, payout address | No accessible name (placeholder only) | Visible-to-AT `<label>` / `aria-label`, localized |
| 5 | 2.4.3 Focus Order / 4.1.3 | Incoming question panel | Panel appeared without moving focus; keyboard/SR users missed it | Focus moves to the question heading when shown and returns to the prior element when hidden (`app/src/a11y.js`) |
| 6 | 4.1.2 | Answer countdown | Purely visual bar | `role="progressbar"` with `aria-valuenow` updated in 10% steps (avoids flooding SRs) |
| 7 | 4.1.3 Status Messages | Worker status, push status, bank-withdraw status, copy status, activity logs, dashboard job status | Async changes (awaiting_workers → reconciling → settled) not announced | Polite live regions (`role="status"` / `role="log"`); dashboard list is a polite live region and badges use text labels |
| 8 | 2.4.1 Bypass Blocks | All app pages | No skip link | Skip link + focusable `<main id="main">` |
| 9 | 1.3.1 | Leaderboard / admin tables | Header cells without scope, `#` column unnamed, no caption | `scope="col"`, "Rank" SR text, caption |
| 10 | 2.4.7 Focus Visible | Buttons/links | Relied on UA default, lost on custom-styled buttons | Global 3px `:focus-visible` outline |
| 11 | 1.3.4 / 1.4.10 | RTL layout | Physical `left/right` rules | Logical properties (`margin-inline-start`, `inset-inline-start`, `text-align: start`) |
| 12 | 2.3.3 (AAA, cheap) | Countdown animation | — | Honours `prefers-reduced-motion` |
| 13 | 3.1.1 Language of Page | All pages | `lang` fixed to `en` even when translated | `lang`/`dir` set from the active locale |
| 14 | — (HTML validity) | `index.html` | `<meta name="theme-color" href=…>` | `content=` |

## Automated enforcement

`app/scripts/a11y-check.mjs` runs axe-core (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) against
every page in both `en` and `ar`. The `a11y` job in `.github/workflows/ci.yml` builds the app,
serves it plus the landing page, and fails the build on any violation.

## Screen-reader test protocol

Run with NVDA + Firefox (Windows) and VoiceOver + Safari (macOS/iOS) in both English and Arabic.

1. **Worker console — go online & answer**: Tab from the skip link through connect → quick
   start → backup panel (secret field announced with its label; Reveal announces pressed state)
   → go online. Confirm the demand level is spoken as text for each topic. Trigger a question:
   focus must land on "Incoming question", the countdown is announced as a progressbar, the
   answer field has a name, and submission status is announced.
2. **Buyer dashboard — ask & watch settlement**: after connecting, "Live updates connected" is
   announced; while a job moves awaiting_workers → reconciling → settled, each change is
   announced once via the question list / activity log without focus moving.
3. **Leaderboard**: table is announced with caption, column headers are read for each cell,
   and the rank column is named.
4. **Landing**: skip link works, nav toggle announces expanded state, language switch re-reads
   the page in Arabic with correct RTL reading order.

Record the result (pass/fail, AT + browser versions, notes) for each step in the PR that
changes the affected flow.
