# Civic Lookup

Find Canadian elected representatives and boundary records using [Represent by Open North](https://represent.opennorth.ca/). Public browser application at **https://coolcode.ca/civiclookup/**. No API account or secret is required.

<!-- coolcode:guide -->
Civic Lookup accepts **any syntactically valid Canadian postal code**, or latitude/longitude entered explicitly. Search is not restricted to the city presets. It shows source-reported representative names, offices, districts, assemblies, parties and public office contacts, with official profile/source links. Filter by government level or text, inspect boundary records, and save CSV or a complete JSON lookup receipt. JSON receipts can be reopened locally without sending them to a provider.

The opening Ottawa city-centre result is a dated, real saved example, not a live lookup. A submitted lookup sends only the chosen coordinates or postal code (plus normal connection information) to Open North. There is no automatic geolocation or local search history. Receipts include the location query: review them before sharing.

Postal codes can overlap districts. Available **centroid** and **concordance** matches are combined, deduplicated and labelled. Open North omits representative groups with no matches; these are accepted as empty groups while the original response is preserved in exported receipts. Coordinates narrow the geographic match, but neither method guarantees current officeholders or complete municipal coverage. A retrieval date is not an election date or source-update date. Other boundary records may include historical district versions, school boards and statistical areas; records linked to a returned representative are labelled separately. Confirm contacts and electoral eligibility through the official institution or election authority.

**Expand or customize:** edit `web/config.json`. Change `defaultQuery`, add/remove `presets` (any postal code or coordinates), or tune `pageSize`, `maxPages`, `timeoutMs`, `requestGapMs` and `importMaxBytes`. Presets only fill the form; pressing **Find representatives** submits it. No allowlist of places exists. To replace the saved public example, set `defaultQuery` to a public location and run `python3 scripts/refresh_example.py`, then commit `web/config.json` and `web/data/example.json`. The collector preserves the last-good file on an error and rejects truncated examples. Run the repository's **Browser tool · Check and publish** workflow after committing; main-branch changes build and publish automatically. There is no scheduled collector and no need to rerun it to search a new location.
<!-- /coolcode:guide -->

## Sources, access and limits

- [Official Represent API reference](https://represent.opennorth.ca/api/), checked 2026-11-23: public JSON API, free up to **60 requests/minute**. More queries require contacting Open North. No registration/key is documented for this use.
- [Represent privacy policy](https://represent.opennorth.ca/privacy/): describes provider request/IP logging. The app sets `credentials: omit` and `referrerPolicy: no-referrer`; postal codes and coordinates remain visible to the destination API.
- Actual ordinary HTTPS requests to `/representatives/?point=45.4215,-75.6972&limit=100`, `/boundaries/?contains=45.4215,-75.6972&limit=100`, and `/postcodes/K1A0A6/` returned JSON with `Access-Control-Allow-Origin: *` during development on 2026-11-23. Browser/provider policy can change. Failed lookups leave the prior capture visible with an error, rather than displaying stale results as a new success.
- Data attribution: **Represent by Open North**, together with each record's original public institution link. Boundary sources and reuse terms can differ between sets; follow the linked boundary-set records. This app does not relicense provider data or claim to be an official electoral service.
- One postal lookup uses one request. A coordinate lookup retrieves representatives and boundaries separately and follows pagination. Requests are spaced by at least 1.1 seconds by default. A live capture reaching the page cap is visibly labelled partial; increase `maxPages` within documented bounds if needed. The default saved-example collector rejects partial results.
- The API returns multiple historical boundary sets. We do not infer currentness from a district name or elect a single match arbitrarily. Representative-level labels are based on the reported office (MP, MLA/MPP/MNA/MHA, Mayor/Councillor/Reeve); unfamiliar titles remain **Other**.

## Configuration example

```json
{"label":"Another public place","mode":"coordinates","latitude":49.2827,"longitude":-123.1207}
```

Add that object to `presets`, or use `{"label":"Parliament postal example","mode":"postal","postalCode":"K1A0A6"}`. Existing defaults are approximate public city-centre coordinates, not a user's address. `apiBase` remains the official HTTPS Represent host to keep source provenance and pagination constrained. `examplePath` is a local `./data/name.json` file. Query-specific data comes from the provider, never from a built-in list of representative names.

## Develop and verify

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

The build copies only `web/` into `dist/`; no package install or live API access is needed. Transformations, validation, deduplication, CSV and receipt handling live in `web/model.mjs`; DOM/network behavior in `web/app.mjs`. Rendering uses text nodes, and source links accept HTTP(S) only. Live requests and imported files never cause arbitrary fetches: pagination must remain on the expected Represent endpoint.

CI also runs `tests/browser_smoke.py` in Chromium at a project subpath, checking saved data, custom coordinate and postal lookups, optional representative groups, filtering, exports, import, error preservation and the 390px layout. The postal regression fixture is the actual documentation example at `/postcodes/L5G4L3/`, captured on 2026-11-23, with `representatives_concordance` absent. Browser network tests use deterministic API fixtures; the source checks above are separate real requests. The deployment workflow publishes on successful main-branch builds. GitHub Actions artifacts retain browser screenshots and reviewable site output for seven days; they are not an archive of user searches.

`tool.json` supplies the CoolCode catalogue metadata. `README.md`'s marked guide supplies the longer usage note. `dist/` is generated and must not be committed. This is a static GitHub Pages tool; there is no backend, user account, mail sending, or search-history service.
