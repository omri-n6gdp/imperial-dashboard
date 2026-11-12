# Imperial Dashboard

## Opening the dashboard

Click **Imperial Dashboard** in your Dock (the app sits in this folder). It starts the dashboard in the background if it isn't already running and opens it in Safari at http://127.0.0.1:8766.

- **Pages:** Home (with a heads-up strip of what needs you), Problem sheets, Revision (tabs: Topics, Sky, Flashcards, Past papers with timed mocks; topic pages have a study buddy with a Viva and, for some topics, a live physics demo), Deadlines and Marks (with a What if… calculator), from the bar at the top. **Search** (press `/` or `⌘K`) looks through topics, questions, deadlines and the text of your notes. **Ask** answers questions from your files, and each revision topic has a **study buddy** beside its notes.
- It only runs on your Mac and only answers this Mac's own browser. Nothing is uploaded (except what you send through Ask: Claude runs on your Pro plan through Claude Code on this Mac; Groq, if you add a key, gets the question and the matching bits of your notes).
- It reads this folder live: changes to any `.md` file show up when you refresh, or within five minutes by themselves.
- What you change in the dashboard is saved straight back into the files: deadline ticks (`deadlines.md`), the status of each question and part (`problem-sheets/questions/*.md`, which also sets the sheet's status in `problem-sheets/index.md`) how well you know each topic (`revision/topic-tracker.md`), your flashcard schedule (`revision/flashcards.json`) mock exams (`revision/mocks.json`) and your study log (`revision/studylog.json`: timed sessions and what you did each day). A mis-click on a deadline or a topic can be undone from the message that appears.
- The revision timetable is worked out in the page from `revision/plan-settings.md` (weekly hours, days off) and redone whenever you mark a topic.
- **After an update**, click the Dock app once: it restarts the background server if its version is out of date. The server stops when you restart the Mac and starts again on the next click. Its log is `~/Library/Logs/Imperial Dashboard.log`.
- **Without the Dock app:** double-click **Imperial Dashboard v2.command** (keep its Terminal window open), or run `python3 "_meta/app-v2/server.py"`.
- The first time, macOS may say it can't verify the app or the `.command` file. Right-click it, choose **Open**, then **Open** again. If it asks to install the Command Line Tools (for Python), accept and try again.
- **The original one-page dashboard** is still here and uses the same files: double-click **Imperial Dashboard.command** (http://127.0.0.1:8765). Both can run at once.

# The data folder

All the information the study dashboard reads. Each `.md` file starts with a `---` block of structured data (dates, weights, status) and continues as readable notes.

```
_meta/        where data came from, sync history, things I need from you; app/ is the dashboard
year/         degree-wide info: key dates, programme, policies, exams, contacts
calendar/     timetable.md (weekly pattern, from the department grids) + original xlsx
deadlines.md  every deadline across all modules, by date
revision/     topic tracker, plan settings (weekly hours) and the generated revision plan
modules/      one folder per module
```

## Inside a lecture-based module (e.g. `modules/PHYS50004-quantum-physics/`)

| File / folder | Contents |
|---|---|
| `module.md` | Team, help sessions, aims and learning outcomes, assessment weights, exam format, past-paper notes |
| `schedule.md` | Week → topic → notes, slides, recordings, problem sheets, release dates |
| `assessment.md` | Every assessed item with due date, status and mark |
| `files.md` | Every Canvas file, where it's stored here, and when locked ones unlock |
| `notes/`, `slides/` | Original PDFs plus `.txt` extractions |
| `problem-sheets/` | `index.md` (your progress) plus sheets, solutions, seminars and assessed sheets |
| `problem-sheets/questions/` | One `.md` per sheet, question by question with LaTeX maths, page links and your per-question status (`figures/` holds cropped diagrams). The dashboard opens these. |
| `lecture-summaries/` | One `.md` per chapter or lecture: topics, key equations, definitions (built from the notes) |

**Maths in the `.txt` files** is written on one line: `x^2` (superscript), `k_B` (subscript), `(a)/(b)` (fraction), `√(…)`, `∫_0^V` (limits), `x̂` (accents). Text from scanned papers starts with an `[OCR …]` line, and handwritten solutions start with a `[Transcribed …]` line. `_meta/tools/pdf2txt/` makes them.

**Fields you can edit yourself** (or through the dashboard): problem-sheet `status`, per-question `status` in `problem-sheets/questions/*.md` (not-started, attempted, stuck, done), deadline `status`, and topic `confidence` / `last_reviewed` in `revision/topic-tracker.md`.

## Other module layouts

- **Lab (`PHYS50001`):** `experiments/<name>/experiment.md` (one per cycle: aims, session plan, report brief, to-dos) plus `shared/` (rubric, templates, exemplars, timetables).
- **Space Mining (`EART60031`):** `case-files/` (your operation's dossier and the shared data pack, with readings), `lectures/`, `activities/` and `assignments/`.

**Status (29 Oct 2026):**
- All 6 modules and the year-level info are built. Mathematical Methods has a placeholder until its Canvas course opens in Term 2.
- 173 Canvas files are downloaded with text.
- 20 lecture summaries are written.
- Deadlines, timetable and topic tracker are in place.

**4 Nov 2026:** the dashboard app (`_meta/app/`) and the revision planner are installed. The first plan covers 7 Nov to the end of the May exams at about 5 hours a week in term.

**10 Nov 2026:** the dashboard described above is the second version (`_meta/app-v2/`, built 6–9 Nov on the same data and the same server code as the original in `_meta/app/`). A full check of the code and data was done on 10 Nov; what was found and fixed is in `_meta/sync-log.md`.

## About this repo

This public copy holds the dashboard's code only. The course material (Imperial lecture notes, past papers, handbooks), timetable, deadlines, marks and revision notes live in the same folder on the owner's Mac and are deliberately left out.
