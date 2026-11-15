# LifeQuest

A personal daily tracker for chores, workouts, sleep, steps, weight and water. It has a dashboard and game mechanics (XP, levels, streaks, badges) so you want to open it every day.

It's an installable phone app (a PWA, or Progressive Web App) made of plain HTML/CSS/JS. There's no build step, no server and no account. Your data stays on your phone.

## Features

- **Today screen.** One tap opens a big number pad with your last value and quick-pick chips. Tracked items that add up (water, workout) get a one-tap **+** button. Chores are checkboxes, with weekly chores counting once per week. Use **‹** to backfill a day you missed.
- **Dashboard.** Shows your average daily score versus the previous period, your streak, perfect days and XP. A 15-week consistency heatmap shows how often you logged. Each tracker gets a 7/30/90-day chart with its goal line; weight gets a 7-day moving average. Chore completion rates are shown too. Tap any chart for exact values, or open its table view.
- **Gamification:**
  - **XP:** +10 per log, +20 per goal hit, points for each chore, +50 for a perfect day, and a streak bonus of up to +50 a day.
  - **Levels:** 20+ levels, each with a title.
  - **Badges:** 20 badges, each with a progress bar.
  - **Celebrations:** confetti and a vibration when you hit a goal, level up or unlock a badge.
- **Hands-free logging by URL.** Your phone's automations can log for you (see below).
- **Customizable.** You can add, rename or disable trackers, set goals as "at least", "at most" or "just log", and edit chores and their point values.
- **Works offline**, follows your phone's light/dark mode, and can export and import a JSON backup.

## Put it on your phone

1. **Host it on GitHub Pages.** On GitHub, open this repo's **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then pick the branch and `/ (root)`. A minute later it's live at `https://<your-username>.github.io/hello-world/`. On a free GitHub plan the repo must be public for Pages to work. Only the code is public; your data never leaves your phone.
2. **Install it:**
   - **iPhone:** open the URL in **Safari** → Share → **Add to Home Screen**.
   - **Android:** open it in **Chrome** → ⋮ → **Install app**.

   Opened from the home-screen icon, it runs full-screen like a native app.

## Hands-free logging (steps, sleep, …)

Opening a URL like this logs those values right away:

```
https://<you>.github.io/hello-world/?steps=8500&sleep=7.5&add_water=1&chore=Dishes
```

| Parameter | What it does |
|---|---|
| `steps=8500` | set today's value (works for any tracker key or name) |
| `add_workout=30` | add to today's value |
| `chore=Dishes,Vacuum` | tick chores, matched by name |
| `date=yesterday` or `date=2026-11-14` | log a past day |

**iPhone (Shortcuts app):** go to Automation → *Time of Day* (e.g. 9:30 pm) → *Run Immediately*. Add these actions:

1. *Find Health Samples* where Type is **Steps**, Start Date is **Today**.
2. *Calculate Statistics*: **Sum**.
3. *Text*: `https://…/hello-world/?steps=` followed by that Statistic.
4. *Open URLs*.

Sleep works the same way with *Sleep Analysis* (Calculate Statistics → Sum of duration, in hours). You can also add the same actions to a home-screen shortcut, or to a Back Tap gesture (iPhone Settings → Accessibility → Touch → Back Tap).

**Android:** Tasker, MacroDroid or Google Assistant routines can open the same URL. Pass the value from Health Connect or Google Fit.

## Your data

Everything is stored in your browser's local storage on the device. Export a backup now and then from **Settings → Your data** (also how you move to a new phone). iOS keeps home-screen web apps' data, but deleting the home-screen icon erases it.

## Development

There's nothing to build. Serve the folder and open it:

```
python3 -m http.server 8000   # → http://localhost:8000
```

Files: `index.html` (shell), `app.js` (all logic and views), `styles.css`, `sw.js` (offline cache: bump `CACHE` when you change files), `manifest.webmanifest`, `icons/`.
