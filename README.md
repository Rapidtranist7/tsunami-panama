# Tsunami Panamá

Earthquake, tsunami-threat and NOAA DART buoy monitor for Panama's coasts.

- Official PTWC threat status for the selected coastal zone (Pacific / Caribbean), never inferred from magnitude.
- Latest and strongest USGS earthquakes, with distance to your zone, on a MapLibre map.
- Live NOAA DART buoy water-column readings (NDBC).
- Archive of PTWC bulletins naming Panama.
- English / Spanish.

## Deploy on Netlify (recommended path)

The site is a static Vite build plus two Netlify Functions:

| Piece | Where | Purpose |
|---|---|---|
| Static site | `dist/public` (built by `npm run build:client`) | The React app |
| `netlify/functions/api.ts` | `/api/*` | Proxies and normalises USGS, NDBC and tsunami.gov feeds |
| `netlify/functions/poll.ts` | scheduled, every 5 min | Keeps the PTWC archive growing with no visitors |
| Netlify Blobs store `ptwc-archive` | automatic | Persists the PTWC bulletin archive |

### Option A — Git-based deploy (easiest to maintain)

1. Push this folder to a GitHub, GitLab or Bitbucket repository.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Netlify reads `netlify.toml`, so the settings are pre-filled:
   - Build command: `npm run build:client`
   - Publish directory: `dist/public`
   - Functions directory: `netlify/functions`
   - Node version: 20
4. Click **Deploy**. Every push to the default branch redeploys.

### Option B — Netlify CLI from your computer

```bash
npm install
npm install -g netlify-cli
netlify login
netlify init          # create a new site (or link an existing one)
netlify deploy --build --prod
```

`netlify dev` runs the site locally with the functions and a local Blobs emulator.

Note: a plain drag-and-drop "Netlify Drop" upload only publishes static files and will not run the functions,
so the data panels would show "Unknown". Use Option A or B.

### Nothing to configure

- No API keys or environment variables are needed; all upstream feeds are public.
- Netlify Blobs and Scheduled Functions are enabled automatically for sites deployed with `netlify.toml`.

### Custom domain

Site settings → Domain management → Add a domain. Netlify provisions HTTPS automatically.

## Local development (Express version)

The repo also contains the original Express + SQLite server used for previews:

```bash
npm install
npm run dev        # http://localhost:5000
```

## Data sources

- NOAA Pacific Tsunami Warning Center — https://www.tsunami.gov/
- USGS Earthquake Hazards Program — https://earthquake.usgs.gov/earthquakes/feed/v1.0/
- NOAA NDBC DART buoys — https://www.ndbc.noaa.gov/dart.shtml
- SINAPROC Panamá — https://www.sinaproc.gob.pa/
- Instituto de Geociencias, Universidad de Panamá — https://sismosgeociencias.up.ac.pa/
- Map tiles © OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors

## Important caveats

- This is an informational prototype. It does not predict earthquakes and does not replace SINAPROC evacuation orders.
- DART 32411 (West Panama) has been adrift since June 2025 and is listed by NDBC for redeployment in March 2027; the app shows the nearest reporting buoys instead.
