# Application Tracker

Application Tracker is a web app that helps students keep track of job applications, trainee programs and bachelor project requests sent to companies.

**Live app:** [heider-khalaf.github.io/ApplicationTracker](https://heider-khalaf.github.io/ApplicationTracker/)

A kanban board with follow-up reminders, deadlines, interviews, activity history and a sortable list view.
Plain HTML, CSS and JavaScript — no frameworks, no build step, no backend.

## Files

| File                    | What it does |
|-------------------------|--------------|
| `index.html`            | Page structure: header, overview, filter/search bar, board, list view, the add/edit dialog and the card template. |
| `style.css`             | All styling: color tokens (one muted color per status), overview, board/cards, list view, dialog, mobile layout and dark mode. Fonts (Cormorant Garamond + Work Sans) load from Google Fonts. |
| `app.js`                | All logic: saving to localStorage, demo data, board + list rendering, add/edit/delete, search and filters, drag and drop (mouse + touch), follow-ups, deadlines, interviews, activity history, backup export/import. |
| `manifest.webmanifest`  | Lets you install the app on your phone or computer (name, icons, colors). |
| `sw.js`                 | Service worker: makes the app open offline once it has been loaded. |
| `icons/`                | App icons for the home screen. |

## Your data

Everything is stored in your browser's `localStorage`. Nothing is sent anywhere and nothing personal is in the code.
That also means data is per browser and per device, and clearing site data deletes it — so **use Export now and then**.
The header shows when your last backup was (it turns orange when there's none, or it's older than 30 days).

- **Export** downloads `application-tracker-backup-YYYY-MM-DD.json` with all your applications.
- **Import** loads a backup file and replaces what's in the app (you're asked to confirm first).
  This is also how you move your data between laptop and phone.

On the very first visit six made-up example applications are loaded. Delete them whenever you like —
they won't come back. To start over with the demo data, run this in the browser console and reload:

```js
localStorage.removeItem('applicationTracker.applications.v1')
```

## Using it

- **Add**: “New application”. Choose status **To apply** for postings you haven't applied to yet — add the
  application deadline and it shows up in “Coming up”.
- **Open / edit**: click a card (or a row in the list). The dialog shows the full **activity history**:
  when it was sent, replied, moved to interview, followed up, and how long the company took to respond.
- **Move**: drag a card to another column. On a phone, press and hold a card for a moment, then drag.
  In the list view you can change the status right in the table.
- **Follow-up**: cards in *Sent* with no reply for more than 14 days get a terracotta highlight.
  Click **Followed up** after you've sent a reminder — it's logged and the 14-day clock restarts.
- **Interviews**: add a date and time in the dialog; it's shown on the card and in “Coming up”.
- **Search & filter**: the search box matches company, contact and notes; the tabs filter by type.
- **Board / List**: the list view is a sortable table — click a column title to sort.

## Run locally

Open `index.html` in a browser. Everything works straight from the file, except offline mode and
installing — those need the [live app](https://heider-khalaf.github.io/ApplicationTracker/).

## Install it like an app

- **iPhone (Safari)**: open the [live app](https://heider-khalaf.github.io/ApplicationTracker/) → Share → **Add to Home Screen**.
- **Android (Chrome)**: open the link → ⋮ menu → **Install app** / **Add to Home screen**.
- **Desktop (Chrome/Edge)**: click the install icon in the address bar.

It then opens full-screen with its own icon and works offline. Note: the installed app has its own storage
on that device — use Export/Import to move data between devices.
