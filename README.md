# Week

A local-only weekly habit tracker. Four screens — Today, Week, Health, Totals — plus Settings.
No accounts, no server, no network calls. Everything lives in `localStorage` on the device.

## Screens

- **Today** — today's daily ticks, the work stepper (day and week goals), this week's quotas,
  and the lock-in button. The weigh-in row only appears on the configured day, and only
  becomes tappable at the configured time.
- **Week** — the 7-day grid for the selected week, plus a scrollable list of previous weeks.
  Tapping one opens that week.
- **Health** — weight line chart, calories cut, fasting days/hours, healthy-meal days.
- **Totals** — points, streaks, weeks won, badges.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup and dialogs |
| `app.js` | All logic, state, rendering |
| `styles.css` | Styling |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Offline cache |
| `icon.svg` | App icon |

## Run it locally

```bash
cd weekly-tracker
python3 -m http.server 8080
```

Then open `http://localhost:8080`. The service worker needs `http://localhost` or HTTPS;
opening `index.html` directly from the filesystem works, but is not installable and
browsers may treat storage for `file://` differently.

## Put it on Android

1. Host the folder somewhere over HTTPS (GitHub Pages, Cloudflare Pages, Netlify — all free).
2. Open the URL in Chrome.
3. Menu → **Add to Home screen** / **Install app**.

Once installed it opens full-screen and works offline.

## Data

- Stored under the `localStorage` key `week.v1`.
- **Settings → Data → Export** writes a JSON backup.
- **Import** restores one.
- Clearing browser data for the site wipes everything — export first.

## Model

```
state = {
  settings: { tdee, calGoal, fastStart, fastEnd, workDaily, workWeekly,
              weighDay, weighTime, startBy, lockTime },
  tasks: [ { id, name, emoji, target, maxDay, work, daily, kind } ],
  days: {
    "YYYY-MM-DD": {
      checks: { taskId: count },
      work: minutes,
      weigh: kg,
      off: bool,
      drought: bool,
      locked: bool,
      lockedAt: ms
    }
  }
}
```

- `target` is per week, `maxDay` is the per-day cap. `target = 7 × maxDay` means "every day".
- `daily: true` puts the task on the Today screen.
- `work: true` exempts the task on **work drought** days.

## Rules

- **Clean day**: every `daily` task at its `maxDay`, and any work logged.
- **Week won**: every task at its effective target, and work at its effective weekly goal.
- **Day off** removes the day from all denominators. **Work drought** removes it from work
  and work-linked tasks only.
- **Lock** freezes a day. **Settings → Day → Unlock today** reverses a mis-tap.
- **Weigh-in** is only offered on the configured weekday, and only from the configured time.
- **Calories cut** = `TDEE − daily goal` per day with 2 healthy meals, half for 1.
- **Expected loss** = total cut ÷ 7700 kcal/kg, shown next to the actual weigh-in line.
