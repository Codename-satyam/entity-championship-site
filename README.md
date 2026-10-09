# The Entity Championship — simplified static site

A minimal Dead by Daylight tournament toolkit. The match flow is intentionally limited to bracket control, the pre-match ceremony, action-based scoring, and the live scoreboard. It uses plain HTML, CSS and JavaScript with no build command. Vercel hosts the static pages; Supabase stores the shared state and broadcasts changes to both streamer controllers and any live overlay.

## Project structure

```text
index.html                  Root entry point
vercel.json                 Vercel routing
pages/
  index.html                Tournament home
  live.html                 Audience scoreboard (also ?overlay=1)
  toss.html                 Toss → map veto → Killer draft → scoring handoff
  bracket.html              Team setup, bracket and action-based scoring
shared/
  shared.css                Shared styles and responsive layout
  shared.js                 Tournament state, bracket generation, Supabase Auth and Realtime sync
  supabase-config.js        Supabase project URL and browser-safe publishable/anon key
  scoring-engine.js         Role-swapped Survivor/Killer scoring calculations
  live-page.js              Live scoreboard renderer
  toss-page.js              Coin toss, map veto and Killer draft workflow
  bracket-page.js           Bracket control and scoring menu
data/
  teams.json                Empty data template (bracket teams are saved locally)
  matches.json              Empty data template (match state is saved locally)
  maps.json                 Configurable map pool used for random veto options
  killers.json              Configurable Killer pool used for random draft options
assets/                     Optional images and logos
scripts/                    Project checks and Supabase RLS setup SQL
```

## Run locally

From this folder, run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. Do not open the HTML files by double-clicking them; browser `fetch()` and cross-tab synchronization work more reliably when served over HTTP.

## Deploy to Vercel

1. Put the contents of this folder at the root of a GitHub repository.
2. Import that repository into Vercel.
3. Keep the project as a static site. No build command is required; leave the output directory at its default/empty value.
4. The included `vercel.json` maps `/`, `/index.html`, `/live.html`, `/toss.html`, and `/bracket.html` to the pages in `pages/`.

## Match-day workflow

1. Open `/bracket.html`, enter one team name per line, and generate the elimination bracket.
2. Select a playable bracket match and choose **Toss → Setup → Score**. The toss ceremony is always the first step of the match workflow.
3. The coin toss winner earns the first map ban and first Killer pick. One team calls Heads or Tails; the result determines which team starts the draft.
4. Five maps are sampled randomly from `data/maps.json`. Teams alternate bans, starting with the toss winner. With five options, four bans leave exactly one map; that map is locked for the match.
5. Five Killers are sampled randomly from `data/killers.json`. Both teams lock one Killer from those same five options in toss-winner-first order. A Killer can only be locked by one team in that draft.
6. After the second Killer is locked, the site saves the toss, veto history, final map and Killer picks to that bracket match, then automatically returns to the bracket and opens the scoring menu.
7. Score Game 1 (Team A Killer / Team B Survivor), confirm it, then score Game 2 with roles swapped. Confirm both games, review the combined score, and choose **Complete match & advance**. For a tied team total, choose the tiebreak winner before completion.
8. Keep `/live.html` open in another tab of the same browser. The live scoreboard displays points, match state, toss winner, selected map and both Killer picks. For an overlay-style view, use `/live.html?overlay=1`.
9. Use **Export state JSON** in bracket control to back up the current tournament.

## Configure the tournament pools

`data/maps.json` and `data/killers.json` must each be a JSON array containing at least five unique name strings. The map pool currently reuses the map names from the uploaded legacy toss page, and the Killer pool contains the organizer-provided 21-name list: Billy, Blight, Nurse, Wraith, Doctor, Freddy, Clown, Spirit, Legion, Plague, Demogorgon, Oni, Artist, Mastermind, Singularity, Chucky, Unknown, Lich, Drac, Ghoul and Jason. Replace or prune these entries to match the tournament-approved pools before match day. The ceremony samples five unique names from each pool for each match. Once a map ban or Killer lock has happened, the corresponding pool cannot be rerolled for that match. A completed setup can be reviewed from the toss page.

## Action-based scoring

Each match has two games with roles swapped:

- **Survivor:** 1 point per completed generator (0–5), 1 point per exit-gate escape (0–4), and +1 for a Hatch escape.
- **Killer:** 1 point per generator remaining (derived as 5 minus completed generators), 1 point per kill (0–4), +1 if all four kills occurred before Endgame, and +0.5 per hook (0–12 hooks).

The Killer can score 10 base points plus up to 6 hook-bonus points per game. Preset buttons show the points being awarded. Each game must be confirmed before the match can be completed and the winner advanced.

## Supabase setup (required for cross-device sync)

1. Create a Supabase project and open **SQL Editor**.
2. Run `scripts/supabase-setup.sql` to create the tournament state table, admin allowlist and row-level security policies.
3. In Supabase **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key). Paste them into `shared/supabase-config.js`. Do **not** use the `service_role` key in browser code.
4. In Supabase **Authentication → URL Configuration**, add your Vercel site URL to the allowed redirect URLs. For local testing, also add `http://localhost:8000/**`.
5. Deploy the project to Vercel. Open `/bracket.html` or `/toss.html` on the deployed site and click **Streamer sign in**. Each streamer should sign in once using their own email link.
6. In Supabase **Authentication → Users**, copy each streamer's user UUID. In SQL Editor, run this once for each approved streamer (replace the UUID):

   ```sql
   insert into public.tournament_admins (user_id)
   values ('PASTE-STREAMER-USER-UUID-HERE')
   on conflict (user_id) do nothing;
   ```

7. Refresh both control pages. The status strip should say **Controller · email**. Both authorized streamers can run the toss, edit scores and manage the bracket. The `/live.html` page and `/live.html?overlay=1` read shared state but do not receive write access.
8. Open the exact same deployed `/live.html?overlay=1` URL in both OBS Browser Sources or browsers. Changes saved from either controller are persisted in Supabase and pushed to connected screens through Realtime.

The database uses revision checks so if both streamers save at nearly the same time, a stale write is rejected instead of silently overwriting the newer state; refresh/review the latest state and retry. The browser-safe Supabase key is intended to be public; security comes from the row-level security policies and the admin allowlist. Never put a `service_role` key into a static website. The setup uses email magic links, so each streamer needs access to their authorized inbox. Keep the Supabase project's email auth and redirect settings configured before tournament day.

If Supabase credentials are blank, the site deliberately stays in local-only mode for layout testing. That mode does not synchronize across devices. Tournament writes are blocked in configured cloud mode unless the user is signed in and present in `tournament_admins`.

## Safety of bracket advancement

Rebuilding a bracket replaces the tournament. Restarting an unfinished match setup clears that match's toss, map bans, Killer locks and scorecard. To avoid leaving stale advancing teams in later rounds, the ceremony page prevents restarting a match that has already been completed; correct or rebuild the bracket result through the control panel instead.
