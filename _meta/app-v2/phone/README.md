# Phone page ("Imperial · on the go")

A private claude.ai page with a read-only copy of the dashboard for your phone: Today (next deadline countdown,
today's classes, heads-up, progress), Week (next 7 or 14 days), Deadlines and Marks.

- **How it is made:** the dashboard works out a snapshot (`window.icdPhoneSnapshot()`, in `static/phone.js`, the same
  code as the pages), `_meta/dev/make_phone_page.py SNAPSHOT.json OUT.html` puts it into `template.html`, and the
  result is published to the claude.ai page below. The last snapshot is kept in `snapshot.json`.
- **Refreshing:** take a new snapshot in the open dashboard, rebuild, republish to the same page (Claude does this;
  the automatic sync will do it each time it runs). The page shows when its snapshot was taken and turns the note
  amber when it is two or more days old. Times like countdowns and "past" classes follow the phone's clock.
- **Who can see it:** only you, unless you share it from its page on claude.ai.

**The page:** "Imperial · on the go", https://claude.ai/artifact/VqV14DChNWZQebT1jsXY7S (slug e984d6f2-b516-4f40-90d8-01402cff03e1), private.
First published 10 Nov 2026 15:07 from the snapshot of 15:01.

**Refresh, step by step (for Claude or the automatic sync):**
1. In the open dashboard (built-in browser, http://127.0.0.1:8766), make sure it has loaded, then run `JSON.stringify(icdPhoneSnapshot())`.
   Or take a copy of the data folder (no PDFs) into a workspace, run the v2 server there and take the snapshot in a headless browser: the result is the same.
2. Save it as `_meta/app-v2/phone/snapshot.json`, then `python3 _meta/dev/make_phone_page.py _meta/app-v2/phone/snapshot.json index.html`.
3. Republish `index.html` to the slug above (publish_files, patch mode, base_version from get_artifact).
