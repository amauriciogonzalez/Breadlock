# Saved example-match JSON database

The repository's `snapshot/` JSON files are the **durable, shared store**. GitHub Pages serves them directly; no bucket or database server is required. The site reads saved example histories and match metadata first and automatically requests missing matches through the paced API/IndexedDB cache. A browser cannot commit to the repository: the scheduled updater independently discovers and saves new matches for everyone.

## Data and incremental updates

`snapshot/manifest.json` maps 11 example histories and match IDs to content-hashed JSON chunks. It also records pending failures and retry times. The current snapshot is a partial backfill; the manifest lists exact saved/unique counts. Scoring metadata is stored only when actually returned, never as a successful empty match. Optional filtered detail/stage projections are not yet part of the shared snapshot, so those may still load via API.

`match_db_update.py` builds a **temporary SQLite work index** from committed JSON, upserts refreshed histories, requests only missing metadata with 2.5-second start pacing and `Retry-After`, then exports JSON chunks and the manifest. SQLite is ignored by Git and can be deleted; a new runner reconstructs it from JSON. Missing/failed IDs remain eligible for later retries, including across CI runs. Commits prune superseded chunks from the working tree. Git history remains the backup, though frequent updates grow it over time.

To run locally:

```sh
python match_db_update.py --max-metadata 64 --batch-size 32 --prune
python -m http.server 8000
```

Open http://localhost:8000/. `--max-metadata 0` checks histories only; `--force-history` overrides the six-hour history refresh interval; `--offline` verifies/re-exports saved data without API requests. The ignored `data/matches.sqlite` on your machine may be ahead of committed JSON; commit the updated `snapshot/` files to make that data portable.

## Scheduled publishing (no external storage)

`.github/workflows/refresh-match-db.yml` runs every six hours and can also be started with **Run workflow**. It checks out `main`, reconstructs its temporary index, fetches a bounded number of missing matches, tests the result, commits changed `snapshot/` JSON to `main`, and deploys the exact revision to Pages. The regular `.github/workflows/pages.yml` deploys committed snapshots on user pushes. The job needs the repository's **Actions → Workflow permissions → Read and write permissions** (and permission to push to `main` if branch rules restrict bot pushes). GitHub does not run push-triggered workflows for commits made with `GITHUB_TOKEN`, which is why the refresh job deploys directly. No S3 bucket or secret is needed. Scheduled runs have not been verified on GitHub until this workflow is pushed and enabled.

For GitLab Pages, move the scheduled job to GitLab CI and give it a repository write token; the static JSON files and updater remain the same. Browsers still cannot persist their own requests to the shared repository without a server-side writer.

## Verification

```sh
python -m unittest discover -s tests -p test_snapshot.py
node --test tests/*.test.cjs
node --check backend/snapshot_adapter.js
```

Before claiming full no-API example coverage, finish the initial backfill and add the distinct filtered-detail and stage response shapes. Validate a scheduled CI run and a cold browser load before treating production coverage as complete.
