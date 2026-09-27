# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **IMPORTANT:** Whenever you make any changes, you must always ensure that CLAUDE.md stays completely up to date.

## Project context

Suositusautomaatio + website for the Finnish HS podcast "Uutisraportti". The pipeline pulls new episodes from the RSS feed, transcribes the intro + last 10 minutes (the recommendations segment) with Deepgram, then has Claude extract structured cultural/consumer recommendations into `suositukset.json`. That JSON powers the static site at uutisrapsa.fi (Netlify, publishes this repo's root from GitHub `main`).

**Everything lives in this one repo since 16.9.2026** (github.com/albrto/**uutisrapsa** (renamed 16.9.2026 from uutisraportti-suosittelee; GitHub redirects the old name), working copy `/Users/antero/Koodi/uutisrapsa`):

- **Repo root** — the published site (`index.html`, `app.js`, `style.css`, `suositukset.json`), `admin/` UI, `transkriptit/` (shared speaker-labeled transcript cache, robots-disallowed), `scripts/` (the copies GitHub Actions runs), `julkaise.sh`, workflows.
- **`pipeline/`** — the local toolbox (previously a separate iCloud folder `…/com~apple~CloudDocs/Koodi/Uutisrapsa.fi`, and before that Google Antigravity's scratch dir where the project started). Scripts are committed; **secrets and local data copies are gitignored** (`.env`, `venv/`, `suositukset.json` + backups, `historia_json.txt` + backups, `korjaukset.json`, `ohitukset.json`, `korjausehdotukset.json`, `supla_audio_urlit.json`, `ajon_tulos.json`, `validointidata/epailyttavat.*`, `screenshotit/`). Gitignored files never reach GitHub or Netlify — but they also have **no backup** (the iCloud safety net is gone), so treat `pipeline/korjausehdotukset.json` and the local data copies with care.

Netlify serves everything committed at the repo root, so committed pipeline files are public (like `scripts/` always was); `robots.txt` disallows `/admin/`, `/transkriptit/`, `/pipeline/` and `/scripts/` from search engines.

All code, identifiers, comments, prompts, and logs are in Finnish. Match that when editing — don't translate variable names or rewrite prompts in English.

## Design work (phase 1 redesign, started 16.9.2026)

The **Impeccable** design skill (impeccable.style, v4.3.1) is installed project-level for Claude Code: skill + agents + detector hooks live in the gitignored `.claude/` (the installer's duplicate GitHub Copilot copy under `.github/` was deleted — don't reinstall it, it would be committed and published). Use `/impeccable` commands for UI work. **`PRODUCT.md` at the repo root is the product-truth file the skill reads — keep it up to date like this file.** Key confirmed design constraints: flat & stylish look (away from the old purple-glow), light + dark themes via `prefers-color-scheme`, playful podcast-spirited Finnish UI copy, front page serves both "find the newest episode's rec" and "browse everything" jobs, KKV ad-disclosure slot needed for future affiliate links. Style reference (not to copy): https://promille.jyrki-anttila.workers.dev. Redesign work happens on the `dev` branch (Netlify branch deploy, noindex).

**Figma is the design source since 25.9.2026** (https://www.figma.com/design/B5mxiRtOqDNRYgmpsyNCJi/Uutisrapsa). Page "v1 · Nykyinen live-ilme" mirrors the current live site (old purple Inter look; variable collection "v1 · Live-ilme", styles/components prefixed `v1/`); page "v2 · Uusi ilme" is the new look (collection "v2 · Uusi ilme", `v2/` styles/components); "v2 · Luonnokset" holds the user's own rough drafts. **v2 is live on main since 27.9.2026** (built on `dev`, merged to main; the old v1 look is preserved in the git tag `ilme-v1-violetti` — restore with `git checkout ilme-v1-violetti -- style.css index.html app.js kiitos.html muutokset.html`): Google Sans Flex (headings, body) + Google Sans Code (metadata: recommender, dates, inputs, buttons, links, tags, footer) from Google Fonts; green accent `#3bdaa5` instead of purple; no glows or shadows; greyish violet-tinted surfaces; neutral category badges; link chips without emojis (the `lisatieto_linkki` chip is labelled by service — `LINKKIEN_NIMET` host→name map + `linkinNimi()` in `app.js`, since 27.9.2026: Goodreads, IMDb, Spotify, Supla, Yle Areena, HS, NYT, Instagram, museums, theatres …; matched on hostname with more specific hosts listed first, e.g. `areena.yle.fi` before `yle.fi`; unknown hosts, Google searches and a work's own website fall back to "Lisätietoa" — add new services to the map); hero title and stats scale S/M/L (≤640 / 641–1023 / ≥1024 px); mobile hero has 112 px top padding (Dynamic Island); an unobtrusive "Anna palautetta" hero link scrolls to `#palaute` and a matching "Takaisin ylös" link above the feedback form scrolls back to `#alku` (the hero); both use the `.tekstilinkki` class (Figma component `v2/Tekstilinkki`). `style.css` tokens use the Figma v2 names (`--bg-sivu`, `--teksti-toissijainen`, `--aksentti` …) with the old names kept as aliases because `muutokset.html`/`kiitos.html` use them. Inputs render at 16 px on `pointer: coarse` to stop iOS focus-zoom. **Light theme (27.9.2026, dev):** Figma collection "v2 · Uusi ilme" has modes Tumma/Vaalea and each frame has a "… · vaalea" copy; light accent is a darker green `#0a7d58` (≥ 4.5:1 on white) and button text turns white. In `style.css` the light values live twice — under `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) }` and `:root[data-theme="light"]` — so the device setting is the default and the theme switch overrides it. The switch (`#teemakytkin`, top-right corner of the hero, Figma `v2/Teemakytkin`) sets `<html data-theme>` and stores the choice in `localStorage` key `teema`; choosing the same theme as the device removes the stored key so the page follows the device again. An inline `<head>` script in `index.html`, `kiitos.html` and `muutokset.html` applies the stored choice before CSS loads (no flash). Hardcoded colors in CSS were replaced by tokens (`--bg-palkki`, `--verho`, `--nuoli-kuva`) so both themes cover everything. Figma's input components have a `Laite=Hiiri/Kosketus` variant (13 px vs 16 px, style `v2/Koodi/Kenttä kosketus`) matching the CSS `pointer: coarse` rule; iPad and mobile frames use Kosketus.

## ⚠️ Production runs in GitHub Actions, not locally

The live pipeline is `.github/workflows/automaatio.yml`, running Thursdays 16:00 UTC and on pushes to **main** touching `admin/korjaukset.json` or `ohitukset.json` (branch filter added 15.9.2026 so the `dev` branch — Netlify branch deploy at `dev--uutisrapsa.netlify.app`, noindex'd via a `[context.branch-deploy]` build command in `netlify.toml` — can't trigger production runs). The job has `timeout-minutes: 45` (added 15.9.2026 after the 3.9.2026 run hung in `apt-get` for GitHub's full 6 h limit and silently skipped the week — the 10.9. run then caught up both episodes). It uses the pipeline-script copies in `scripts/` and commits results to GitHub → Netlify publishes.

The old local launchd job (`com.uutisrapsa.automaatio.plist`) was **removed entirely 16.9.2026** — it had been permanently failing since ~April 2026 because macOS TCC blocked launchd from executing scripts inside the then-iCloud path ("Operation not permitted"). Local runs are manual-only (`pipeline/aja_automaatio.sh`), so **`pipeline/`'s local data copies drift behind the live site** between manual syncs. Last full manual sync: 6.8.2026 (timestamped backups kept alongside); `synkronoi_pilvi_tiedostot.py` merged admin corrections up to 16.9.2026. The repo-root `suositukset.json` (maintained by Actions) is the authority — re-sync `pipeline/suositukset.json` from it before any local publish.

Consequences:
- **Shared scripts are unified since 16.9.2026 — there is exactly ONE copy of each.** `scripts/uutisraportti_automaatio_deepgram_claude.py`, `scripts/laheta_ilmoitus.py` and `scripts/sovella_korjaukset.py` serve both Actions and the local pipeline: paths are anchored to the repo root, and the local wrappers set `UUTISRAPSA_DATAKANSIO` (data-copy dir, default = repo root = exact old Actions behavior) and `UUTISRAPSA_EPAILYTTAVAT` (default `admin/epailyttavat.json`). A fix lands once; no porting between copies anymore. The name lists + RSS participant parser live in `scripts/nimet.py`, imported by both `scripts/generoi_validointidata.py` and `pipeline/validoi_suosittelijat.py`.
- Apply corrections by pushing `admin/korjaukset.json` on main (triggers the workflow). **Do not run `pipeline/paivita_korjaukset.sh` → `julkaise.sh` without first reconciling `pipeline/suositukset.json` with the repo root's** — it would publish a stale local copy and revert episodes. (Local copies were last synced from root 16.9.2026, so they are current as of that date.)

Monitoring (added 16.9.2026): `.github/workflows/tuoreusvahti.yml` runs Fridays 16:00 UTC and compares fresh RSS guids against the published `historia_json.txt` — alerts only when an episode appeared but wasn't processed (20 h grace for brand-new episodes, so podcast breaks don't false-alarm). `.github/workflows/halytys.yml` fires via `workflow_run` when the automation or tuoreusvahti ends in failure/timed_out/cancelled (covers timeouts that an in-job `if: failure()` step wouldn't). Both alert through the same Netlify Forms email channel as `laheta_ilmoitus.py`; both support `workflow_dispatch` test runs (tuoreusvahti with `testihalytys=true`). Verified end-to-end 16.9.2026 including email delivery. **Gotcha:** Netlify Forms runs Akismet on every submission — a POST with Python-urllib's default User-Agent gets HTTP 200 but is silently classified as spam and no email is sent; any script posting to the form must send a browser/requests-like User-Agent (tuoreusvahti sends `python-requests/2.32.3`, same as `laheta_ilmoitus.py`).

Changelog (since 27.9.2026): `.github/workflows/muutosloki.yml` runs `scripts/generoi_muutosloki.py` on **every push to main** that touches something other than data/docs (`paths-ignore`: `suositukset*.json`, `historia_json.txt`, `admin/**`, `transkriptit/**`, `muutokset.html`, `pipeline/**`, `**.md`), so user-visible changes reach `muutokset.html` and the footer version as soon as they're live — previously only the weekly automation (`automaatio.yml` step 5, still there for correction-triggered runs) wrote the log. The generator summarizes commits back to the latest `Automaatio:` commit, and both workflows commit as `Automaatio: …`, which is what prevents duplicate entries (changes made on the same day are grouped into one version: if today's entry already exists, the generator appends the new `<li>` rows to it and does not bump the version). Both workflows share `concurrency: main-kirjoitus` so they never push over each other; `halytys.yml` also alerts on Muutosloki failures. Tip: write commit messages for user-visible changes so they summarize well — the model turns them into the public changelog text.

## Commands

Local tooling runs from `pipeline/` (there is no test suite):

```bash
cd /Users/antero/Koodi/uutisrapsa/pipeline

# Regular automation (sync corrections from admin/ → process new episodes → email)
./aja_automaatio.sh

# Apply admin corrections (after sync) and republish the site via ../julkaise.sh
./paivita_korjaukset.sh

# Re-attribute recommenders flagged as suspicious (AI proposals for review)
./venv/bin/python3 korjaa_suosittelijat.py --maara 3   # test batch
./venv/bin/python3 korjaa_suosittelijat.py             # all flagged episodes
./venv/bin/python3 korjaa_suosittelijat.py --vie       # export reviewed proposals → korjaukset.json

# One-off: backfill old (2016–2018) episodes scraped from Supla
./venv/bin/python3 keraa_supla_audio_urlit.py     # collect audio URLs (Playwright, headless Chromium)
./venv/bin/python3 prosessoi_puuttuvat.py         # retry episodes still missing audio_url
./venv/bin/python3 prosessoi_vanhat_jaksot.py     # transcribe + extract for the backfill set

# Regenerate validation data (epailyttavat.js + .json) without rerunning the pipeline
./venv/bin/python3 validoi_suosittelijat.py

# Open the local validator UI (served from pipeline/validointidata/)
./kaynnista_validaattori.sh
```

### Python environments — two of them

- **Shell scripts** use `pipeline/venv/bin/python3` (in-repo venv, Python 3.14.3, gitignored; recreated 16.9.2026 at the new path — recreate from scratch if broken, runtime deps: anthropic, feedparser, requests, python-dotenv, pydub, audioop-lts).
- **VS Code** is configured to use `/Users/antero/.venvs/uutisrapsa/bin/python3.14` (see `pipeline/.vscode/settings.json`, gitignored).

Keep both in sync when adding dependencies, or scripts will break depending on how they're launched.

### Required env vars

`pipeline/.env` (loaded via `python-dotenv`, `override=True`, **gitignored — never commit**): `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`. Also present: `OPENAI_API_KEY`, `GITHUB_TOKEN` (legacy/unused in the current Claude+Deepgram pipeline).

## Architecture

### Data flow (local pipeline; Actions runs the same logic from scripts/)

```
RSS (feeds.captivate.fm)
    │
    ▼
scripts/uutisraportti_automaatio_deepgram_claude.py
    │  (sole copy; local wrappers run it with UUTISRAPSA_DATAKANSIO=pipeline/)
    │  ─ downloads MP3
    │  ─ keeps first 5 min + last 20 min  (ALKU_SEKUNTIA = 300, LEIKKAUS_SEKUNTIA = 1200;
    │     intro round can start ~3 min in after ads, so 2 min was too short)
    │  ─ Deepgram nova-2 (fi, diarize+utterances) → "Puhuja N:" labeled text
    │  ─ Claude (claude-sonnet-5, fallbacks sonnet-4-6 / haiku-4-5 / opus-4-6) →
    │     two-pass extraction: main pass + completeness-check pass (kysy_claudelta),
    │     then deterministic recommender normalization (normalisoi_suosittelija)
    ▼
pipeline/suositukset.json   ← local working copy (root suositukset.json is the authority)
pipeline/historia_json.txt  ← append-only list of processed RSS entry.id values (dedup key)
transkriptit/<id>.txt       ← shared speaker-labeled transcript cache at REPO ROOT
                              (committed; id sanitized for filenames)
pipeline/ajon_tulos.json    ← ephemeral; a LIST of every episode processed in the run
                              (since 15.9.2026 — was a single dict that got overwritten
                              per episode, so multi-episode runs emailed only the last
                              one), each entry carrying quality warnings ("varoitukset":
                              uncertain teos names, unknown recommenders, participants
                              with zero recs, completeness-pass additions, conflicting
                              speaker evidence) and, since 27.9.2026, "tunnistukset":
                              per-rec {teos, suosittelija, peruste} — the model's
                              speaker-mapping evidence, listed in the email so a swap
                              between two valid participants is spotted; deleted at
                              run start (stale-leftover guard), consumed by
                              laheta_ilmoitus.py (one email covering all episodes;
                              still accepts the old dict form) then deleted. Gitignored —
                              it was accidentally tracked until 15.9.2026, so every
                              no-new-episode Actions run emailed a stale notification
    │
    ▼
pipeline/validoi_suosittelijat.py   ← the ONLY local validation-data generator since 16.9.2026
    │  ─ cross-checks each rec's "suosittelija" against RSS episode participants
    │  ─ writes pipeline/validointidata/epailyttavat.js (validator UI) AND
    │    epailyttavat.json (read by laheta_ilmoitus.py and korjaa_suosittelijat.py)
    │    with the same strict flagging logic
    ▼
scripts/laheta_ilmoitus.py → Netlify Forms POST (form-name: "automaatio-ilmoitus")
    (sole copy; reads UUTISRAPSA_EPAILYTTAVAT, supports both epailyttavat schemas)
```

Retired 16.9.2026: the local `generoi_validointidata.py`. It wrote `epailyttavat.json`/`.js` with a LOOSER flagging logic (no exact-spelling invariant) and, as the last step of `aja_automaatio.sh`, silently overwrote `validoi_suosittelijat.py`'s stricter output. Now `validoi_suosittelijat.py` writes both files and is what `aja_automaatio.sh` and `validointidata/palvelin.py` invoke (palvelin uses the pipeline venv, since validoi needs feedparser). `scripts/generoi_validointidata.py` is a DIFFERENT script, still used by Actions: it writes `admin/epailyttavat.json` with all recs + `is_suspicious` flags for the admin UI, and shares the exact-spelling invariant. `korjaa_suosittelijat.py` accepts both epailyttavat schemas.

### The correction loop (admin UI → git → pipeline → site)

Corrections and skip-flags are entered through the admin UI at `/admin/` (used mostly on a computer; working nicely on an iPad from the couch is an original wish that still matters for UI work). They reach the local tooling via:

1. `git pull` (done by `aja_automaatio.sh` / `paivita_korjaukset.sh`).
2. `pipeline/synkronoi_pilvi_tiedostot.py` merges `admin/ohitukset.json` and `admin/korjaukset.json` into `pipeline/ohitukset.json` and `pipeline/korjaukset.json` (dedup key: `(jakso_id, r_idx)`, plus `tyyppi` for korjaukset).
3. `scripts/sovella_korjaukset.py` (run by `paivita_korjaukset.sh` with `UUTISRAPSA_DATAKANSIO=pipeline/`) applies corrections in-place to `pipeline/suositukset.json` (with timestamped backup), then `paivita_korjaukset.sh` regenerates validation data and runs `../julkaise.sh` (copies `pipeline/suositukset.json` → repo root, commits, pushes → Netlify).

`ohitukset.json` = permanent "this suspicious recommender is actually correct, stop flagging it" list. `korjaukset.json` = pending corrections to apply once.

**Correction schemas:** `admin/korjaukset.json` uses the **full-record schema** `{jakso_id, r_idx, teos, uusi_data: {teos, suosittelija, kuvaus, paakategoria, kategoriat}}` (can correct any field, `uusi_data` applied wholesale); the old rename-only schema `{jakso_id, r_idx, vanha_suosittelija, uusi_suosittelija}` is still accepted (with a `vanha_suosittelija` mismatch guard). **Additions** (admin UI "＋ Lisää suositus", in the Kaikki/Korjatut views; added 27.9.2026 after the 3.3.2022 episode turned out to be missing two recs) use `{tyyppi: "lisays", jakso_id, r_idx, teos, uusi_data: {teos, suosittelija, kuvaus, paakategoria, kategoriat, google_linkki, lisatieto_linkki}}` and always **append** to the end of the episode, so existing `r_idx` references never shift. `r_idx` is the slot the rec will get, assigned server-side by `netlify/functions/tallenna.js` (= episode length in main's `suositukset.json`, or after any still-pending additions — the deployed site can lag). Because the whole `korjaukset.json` is replayed every run, `sovella_korjaukset.py` skips an addition whose slot is already filled (idempotent) and refuses one whose slot is past the end; a later edit of an added rec is an ordinary correction on that `r_idx`. The admin UI shows saved-but-unapplied additions as recs (badge "Lisätty"). `synkronoi_pilvi_tiedostot.py` dedups by `(jakso_id, r_idx, tyyppi)` so an addition and a later edit of the same slot both survive. (`tallenna.js`/`ohita.js` still pointed at the pre-rename repo name until 27.9.2026 — fixed to `albrto/uutisrapsa`.) Since the 16.9.2026 unification the single `scripts/sovella_korjaukset.py` handles **both schemas in both contexts** — the old local-scripts-skip-new-schema divergence is gone. **Note the consequence:** new-schema entries merged into `pipeline/korjaukset.json` by `synkronoi_pilvi_tiedostot.py` are no longer inert locally; running `paivita_korjaukset.sh` re-applies them to the local copy (idempotent — they're already applied in production data, which local copies are synced from). New corrections should be pushed as `admin/korjaukset.json` on main, which triggers the production workflow.

**Direct edits of the root `suositukset.json`** are also fine for one-off fixes done from Claude Code (e.g. 27.9.2026: the 30.3. and 6.4.2023 episodes — Succession-sessio podcast re-attributed, wrong "(Yle)" label, two swapped recommenders and two missing recs added): `git pull` first, edit only the affected episode, append new recs to the episode's end (never reorder), commit + push → Netlify publishes; Actions keeps the edits because it works on the committed root file. Check first that no `admin/korjaukset.json` entry targets the same `(jakso_id, r_idx)` — the whole list is replayed every run and would overwrite the edit. Old episodes usually have no cached transcript: fetch the audio via the RSS feed, cut with `ALKU_SEKUNTIA`/`LEIKKAUS_SEKUNTIA` and run `transkriboi_deepgram` + `tallenna_transkripti` from the main script (import it with `UUTISRAPSA_DATAKANSIO=pipeline/` so `pipeline/.env` supplies the key), then read the speaker-labeled text to verify attributions; commit the new file in `transkriptit/`.

### AI-assisted re-attribution (pipeline/korjaa_suosittelijat.py)

Re-processes episodes flagged in `pipeline/validointidata/epailyttavat.json`: uses the `transkriptit/` cache (or re-downloads + re-transcribes with diarization), then asks Claude to re-attribute **only** the flagged recommendations by mapping speaker numbers to the names in the episode intro. Writes proposals to `pipeline/korjausehdotukset.json` (`uusi_suosittelija` may be `"tuntematon"`; saved incrementally after each episode, dedup by `(jakso_id, r_idx)` so reruns only process new flags). Nothing touches `suositukset.json` until proposals are reviewed and exported with `--vie` into `korjaukset.json`, then applied via `paivita_korjaukset.sh`. Proposals where the AI *confirms* the current name are candidates for `ohitukset.json` instead.

### Key invariants

- **`historia_json.txt` is the dedup oracle.** Each RSS `entry.id` is appended after a successful run. An episode that produces zero recommendations is still recorded (empty array stored) so it isn't reprocessed.
- **`suositukset.json` is ordered newest-first.** The main script iterates `reversed(feed.entries)` and prepends (`insert(0, …)`). `prosessoi_vanhat_jaksot.py` appends then re-sorts by parsed `paivamaara` (Finnish `%d.%m.%Y`). Don't break this ordering — the site depends on it.
- **Recommendation index `r_idx` is the position inside `jakso["suositukset"]`.** Corrections and skips reference it directly, so reordering or filtering recommendations within an episode will silently corrupt every existing `(jakso_id, r_idx)` reference.
- **The Claude prompt is load-bearing.** It enforces the JSON schema (`teos`, `paakategoria` from a closed list, `google_linkki`, `lisatieto_linkki`, `kuvaus`, `suosittelija`, `kategoriat`) and Finnish translation of foreign names. Changing it changes the output schema — touch with care. The prompt lives **only** in `scripts/uutisraportti_automaatio_deepgram_claude.py` (`rakenna_system_prompt`); `pipeline/prosessoi_vanhat_jaksot.py` and `pipeline/korjaa_suosittelijat.py` import from that module (via a `sys.path` insert). Since 16.9.2026 there is no second copy to keep in sync. Key prompt rules (each added after a real production failure): include joke/atypical recommendations; exclude self-promo ads, news topics, and the host's framing-scenario segues — with one narrow carve-out (27.9.2026, user decision): a speaker's tip in the rec section to listen to a specific *other outlet's* episode where they were a guest (e.g. Tuomas on Futucast / Luomakunta, 3.9.2026) IS a rec, while talking about one's own series is not; a broader "when in doubt, include" wording was tried and rejected because it resurrected the Aperol Spritz framing prop (20.8.), an own-series mention and a news-topic "rec"; fix transcription errors in titles only when certain, otherwise keep as heard and set `epavarma_teos: true` (never substitute a different known work by the same artist); require a `puhuja_peruste` evidence quote for every speaker→name mapping, else `"tuntematon"`; **speaker-evidence hierarchy** (added 27.9.2026 after the 24.9.2026 episode swapped Marko and Salla): Deepgram's diarization boundaries often slip a word or two at turn changes, so a vocative at the start/end of a turn ("Marko? Eikö se…" — actually Tuomas handing over, landed on Marko's line) and end-of-episode thank-yous are WEAK evidence, while self-introductions and third-person references ("Salla puhuu siitä…" → speaker isn't Salla) are STRONG; the model must gather all clues before deciding and report conflicts in `puhuja_ristiriita` (→ email warning). The prompt's examples deliberately use a made-up name ("Anna"), not this episode's. `puhuja_peruste`, `puhuja_ristiriita` and `epavarma_teos` are internal QA fields (`SISAISET_KENTAT`) — they feed the warnings and the email's `tunnistukset` list, then get stripped before saving, so the site schema is unchanged. `analysoi_claudella` returns a 3-tuple `(suositukset, varoitukset, tunnistukset)`. Known limitation: validators only catch misspelled/non-participant names, never a swap between two valid participants — the email's evidence list is the safeguard.
- **Recommender attribution is per-episode, not a fixed whitelist.** The main script parses the episode's participants from the RSS description (via `poimi_osallistujat_rss`, imported from `validoi_suosittelijat.py`) and injects them into the prompt as the only allowed `suosittelija` values; the RSS description is also passed as context in the user message. The model must cite a `puhuja_peruste` evidence quote for each mapping or output `"tuntematon"` — the validator flags those for manual review. **The name spelling never stays model-authored**: `normalisoi_suosittelija` snaps the output to the participant list (exact / ≥0.85 similarity / first- or last-name match), and an unmatched name becomes `"tuntematon"`. When the RSS description names no participants (happens regularly), only near-miss spelling is normalized against `TUNNETUT_NIMET` and unknown names survive (could be genuine guests). Note the main script's system prompt is an f-string: literal `{`/`}` in the JSON example must stay escaped as `{{`/`}}`.
- **Participant name facts** (confirmed): "Iida Sofia Hirvonen" is the correct spelling (not "Ida-Sofia"). Anni Keski-Heikkilä was a podcast regular but left HS (~2023) and won't appear in new episodes; a bare "Anni" in old RSS descriptions means her, not Anni Lassila. These names live **only** in `scripts/nimet.py` (`TUNNETUT_NIMET`/`ETUNIMI_KARTTA`, plus `poimi_osallistujat_rss` and `loytyy`), imported by `scripts/generoi_validointidata.py`, `scripts/uutisraportti_automaatio_deepgram_claude.py` and `pipeline/validoi_suosittelijat.py` — edit them there and nowhere else.
- **Model fallback list (`MALLIT`).** Extraction tries `claude-sonnet-5` → `claude-sonnet-4-6` → `claude-haiku-4-5-20251001` → `claude-opus-4-6`. Two API constraints baked into `kysy_claudelta`: **no `temperature` parameter** (Sonnet 5 rejects it with a 400, which would silently drop every call to the fallback model — and worse, the current anthropic SDK doesn't accept the kwarg at all, raising `TypeError` for *every* model: this silently broke `scripts/generoi_muutosloki.py` from 15.8. to 15.9.2026, fixed by dropping the param) and text extraction must filter `response.content` by `block.type == "text"` (newer models can emit thinking blocks first). A JSON parse failure also advances to the next model instead of being treated as an empty result. **Streaming + `max_tokens=32000`** (since 27.9.2026): Sonnet 5 thinks adaptively by default and thinking consumes `max_tokens` — the old non-streaming 8000 cap regularly produced a thinking-only response (`stop_reason: max_tokens`, no text), silently falling back to weaker models (seen 2/3 test runs even on the old prompt); a large cap needs `client.messages.stream(...).get_final_message()` to avoid HTTP timeouts. Sonnet 4.6 sometimes writes its reasoning before the JSON, so parsing falls back to the outermost `[...]` in the text.
- **Validator exact-spelling invariant.** Both `pipeline/validoi_suosittelijat.py` and `scripts/generoi_validointidata.py` flag any `suosittelija` that is not exactly in `TUNNETUT_NIMET` (except `"tuntematon"`), even when the loose first/last-name match passes — a near-miss like "Johnn Helin" previously slipped through on the surname match.
