# Manual testing checklist

Things the automated tests can't cover: real devices, real Google accounts, real networks.
Tick items off as you go. New features add new items here.

## On your PC (any network)

Run `npm run dev` and open http://localhost:3000 (use `localhost`, not `127.0.0.1`).

### Google sign-in
- [x] Google sign-in as Jack (aceojack@gmail.com) works — confirmed 2026-10-26
- [ ] Google sign-in with **jaimewho1011@gmail.com** signs in as Jaime
- [ ] Google sign-in with **jaimemorcos@gmail.com** also signs in as Jaime (same account, same groups)
- [ ] Signing in with a Google account nobody has added shows "That Google account isn't allowed to use Freewise."
- [ ] After signing in with Google, the Account tab shows your Google profile picture

### Upgrade of your existing local data
- [ ] After restarting `npm run dev`, the Groups tab shows a **"Jack & Jaime"** group (your old ledger was moved into it automatically)
- [ ] It's still there after the second upgrade (for percentage/exact splits and group deletion), with nothing missing
- [ ] Jaime appears in your Friends tab

## On your iPhone over home Wi-Fi

Setup: phone and PC on the same Wi-Fi. Stop any running dev server, then in PowerShell
`$env:HOST="0.0.0.0"; npm run dev`, allow Node.js on Private networks if Windows asks,
and open the printed `http://192.168.x.x:3000` address in Safari. Use the **Dev login** buttons
(Google sign-in only works on localhost until the Pi has HTTPS).

### Tab bar and layout
- [ ] Tab bar (Friends · Groups · Activity · Account) sits above the home bar and is easy to tap
- [ ] The app opens on Groups; the active tab is highlighted
- [ ] No sideways scrolling on any tab; nothing hidden under the notch
- [ ] "+ Add expense" floats above the tab bar and never covers the last expense
- [ ] Dark mode (Settings → Display → Dark) looks right on every tab

### Friends
- [ ] "+" opens Add a friend; the email field shows the email keyboard (with @) and doesn't auto-capitalise
- [ ] Typing an existing person's email says "X is on Freewise." and Add works
- [ ] Typing a new email says "Not on Freewise yet…", asks for their name, and Add works
- [ ] Your own email says "That's your own email address." and Add stays disabled
- [ ] Search filters by name and by email
- [ ] Each friend shows "owes you $X" / "you owe $X" / "settled up" across all groups

### Groups
- [ ] "+" opens Create a group with your friends as tick boxes; creating it opens the new group
- [ ] Groups list shows "with Jaime & Sam" and your balance in each
- [ ] "Add people" on a group page adds a friend to the group
- [ ] "‹ Groups" gets you back

### Adding expenses
- [ ] In a two-person group, the Split dropdown shows the four "Paid by you, split equally…" options
- [ ] In a group of three or more: "Paid by" and "Split" dropdowns, and "Split between" tick boxes
- [ ] Unticking someone updates the preview ("Jaime owes you $150.00")
- [ ] Choosing "Sam owes the full amount" saves as "owed by Sam"
- [ ] Tapping a field does **not** zoom the page in; the amount field opens the number keypad
- [ ] Date field opens the iOS date picker and defaults to today
- [ ] With the keyboard open, Save is still reachable (scroll the sheet if needed)
- [ ] Saving with no description shows the error under Description

### Percentage and exact splits
- [ ] Two-person group: the Split dropdown also has "Split by percentages…" and "Split by exact amounts…"; choosing one shows a "Paid by" picker and a box per person
- [ ] Bigger group: the Split dropdown has "Split by percentages" and "Split by exact amounts"; the "Split between" tick boxes hide
- [ ] The percentage and amount boxes open the number keypad and don't zoom the page
- [ ] Typing 60 then 40 shows "40% left to assign", then "Adds up to 100%" in green, with each person's dollar amount beside their box
- [ ] Exact amounts that don't add up show "$X left to assign" or "$X too much"; saving anyway shows "The amounts add up to $X, not $Y." and fixing a box clears that message
- [ ] A saved percentage expense shows "split by percentage" on its row; tapping it brings back the same percentages
- [ ] Blank or 0 for someone leaves them out of the expense

### Editing and deleting
- [ ] Tapping an expense opens "Edit expense" filled in, and the keyboard does **not** pop up
- [ ] Changing the amount or split and tapping "Save changes" updates the row and the balances
- [ ] "Delete expense" asks "Delete “…”?"; Cancel keeps it, OK removes it

### Settle up and history
- [ ] The balance card shows "You are owed / You owe" plus who owes whom
- [ ] Settle up in a two-person group asks "Record that Jaime paid you $X?"
- [ ] Settle up in a bigger group lists every payment
- [ ] When everyone has paid for things, the sheet says e.g. "These 2 payments settle everyone. Paying each other back directly would take 3."
- [ ] Confirming clears the group's ledger and shows "Settled up…"
- [ ] History lists the settle-up; tapping it shows the payments and the expenses (read-only)

### Group settings (gear icon on a group page)
- [ ] The gear sits next to History and opens Group settings; "‹ (group name)" goes back
- [ ] Renaming saves, shows "Name saved.", and the new name shows on the group page, Groups list and Activity
- [ ] While there are unsettled expenses: people in them say "In unsettled expenses" with Remove/Leave greyed out, and Delete group is greyed out with "Settle up first…"
- [ ] After settling up: Remove asks "Remove Sam from “…”?" and takes them off the list
- [ ] The removed person no longer sees the group, and their Activity says "Jack removed you from …" (not tappable)
- [ ] Leave asks first, then drops you back on Groups without that group
- [ ] Delete group asks first, then the group disappears for everyone; Activity shows "… deleted the group “…”" and old items for it aren't tappable
- [ ] In a group with only you, it says "The only member" and only Delete is available

### Activity
- [ ] Shows "Jaime added “Groceries” in Home." with "You owe $X" / "You get back $X" and the date
- [ ] Shows settle-ups, groups created, renamed and deleted, people added, removed or leaving, and friends added
- [ ] Tapping a group item opens that group
- [ ] "Show older activity" appears once there are more than 30 items

### Account
- [ ] Shows your name and the email(s) you sign in with
- [ ] Changing your display name saves, and Jaime sees the new name in their app
- [ ] Sign out returns to the sign-in screen and hides the tab bar

### Two people at once
- [ ] Sign in as Jack in Safari and as Jaime in a Private tab; add an expense as one, switch to the other tab and it shows up
- [ ] Open Settle up as Jack, add an expense as Jaime, then confirm as Jack: it refuses with "The ledger changed…" and shows the new balances

## After deploying to the Pi (HTTPS)

Steps are in `DEPLOY.md`.

- [ ] The address from `tailscale funnel status` opens on mobile data (Wi-Fi off), not just at home
- [ ] Pi-hole still blocks ads and the internet still works at home after installing Tailscale
- [ ] `sudo reboot` the Pi: Freewise comes back by itself (same address, still signed in)
- [ ] The morning after, `~/freewise-backups` has a new backup and `backup.log` shows no errors
- [ ] The PC's dev login buttons do **not** appear on the Pi address
- [ ] **Add to Home Screen** from Safari's Share menu shows the green split-coin icon and the name "Freewise"
- [ ] Opening it from the Home Screen is full-screen (no Safari address bar) and lands on Groups
- [ ] Google sign-in works inside the home-screen app (it goes to Google and comes back)
- [ ] Turn on Airplane Mode and open the app: it still opens (shows a connection message instead of data)
- [ ] After a new version is deployed, closing and reopening the app picks it up
- [ ] A friend you invite by email can sign in with Google (see note below about Google test users)
