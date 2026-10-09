# Whether Weather

A lightweight, fast weather forecasting web app that compares forecasts from several free
weather APIs in one table. A **consensus** row at the bottom summarizes the available sources
using medians. The interface supports Hungarian and English.

- Requires Node.js 20 or later. The only npm dependency is `@vercel/functions`, used for deployment.
- API keys stay on the server; visitors do not need to register.
- Cached forecasts are embedded directly in the initial HTML. Other sources arrive progressively
  through an NDJSON stream, without waiting for the slowest provider.

## Getting started

```powershell
Copy-Item .env.example .env  # Fill in your API keys (optional)
npm ci
npm start                   # http://localhost:3000
npm run dev                 # Restart automatically when files change
npm test
```

## Deploying to Vercel

1. Select **Add New > Project** and import the GitHub repository.
   Choose the **Other** framework preset; leave the build and output overrides unset.
2. Under **Settings > Environment Variables**, add `CONTACT` and the API keys you use:
   `WEATHERAPI_KEY`, `OPENWEATHER_KEY`, `VISUALCROSSING_KEY`, `METEOSOURCE_KEY`, and `TOMORROW_KEY`.
   `PORT` and `HOST` are not needed on Vercel.
3. Deploy. Subsequent pushes to `main` trigger production deployments automatically.
4. Open `/healthz` to check which sources are configured.

[vercel.json](vercel.json) routes requests to [api/index.js](api/index.js), runs the function in
Frankfurt (`fra1`), and bundles the files in `web/`.
The directory is deliberately **not** named `public/`: Vercel would serve the unprocessed HTML
template as a static file instead of letting the function assemble the page.

### Runtime Cache

On Vercel, **Runtime Cache** backs the fast in-memory cache for both forecasts and geocoding results.
No Redis service or additional API key is required. The `whether-weather-v1` namespace separates
these entries from other applications, including on Hobby plans where storage is shared by a team.
The cache is shared within a region, persists across deployments, and is separate for preview and
production environments.

Even on a cold function instance, the initial HTML snapshot reads cached data without calling the
weather APIs. A new location, or an expired or evicted cache entry, still requires upstream requests.
Caching reduces cold-instance API calls; it does not eliminate the function's own startup time.

- Forecasts remain fresh for 15-60 minutes, depending on the provider.
- Stale forecasts may be served for up to an additional 6 hours while refreshing in the background.
- Shared storage TTL is the fresh plus stale period, converted to seconds.
- Geocoding results use longer retention periods.
- `waitUntil` keeps background refreshes and shared-cache writes alive after the response is sent.
- Cache read/write failures are logged; the app continues using memory and upstream APIs.
- Identical requests are coalesced within each instance, not through a distributed lock.
- Local `npm start` uses only the in-memory cache.

See [Vercel Runtime Cache](https://vercel.com/docs/caching/runtime-cache) for usage, limits, and pricing.

## Data sources

Free-tier limits can change; check each provider's current plan before deploying.

| Source | Key in `.env` | Free tier / notes |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | None | 7+ days; all requested metrics (CC BY 4.0) |
| [MET Norway / Yr](https://api.met.no/) | None (`CONTACT` required) | Approximately 9 days; precipitation probability and gusts are not available everywhere; no solar radiation (CC BY 4.0) |
| [WeatherAPI.com](https://www.weatherapi.com/signup.aspx) | `WEATHERAPI_KEY` | 3 days |
| [OpenWeather](https://home.openweathermap.org/users/sign_up) | `OPENWEATHER_KEY` | 5 days in 3-hour steps; no solar radiation |
| [Visual Crossing](https://www.visualcrossing.com/sign-up) | `VISUALCROSSING_KEY` | 1,000 records/day; check usage charges for requests including hourly data |
| [Meteosource](https://www.meteosource.com/client/sign-up) | `METEOSOURCE_KEY` | 7 daily forecasts; fewer fields and about 24 hourly forecasts on the free plan; attribution link required |
| [Tomorrow.io](https://app.tomorrow.io/signup) | `TOMORROW_KEY` | Approximately 5 days of hourly data; check current daily and short-term request limits |

Sources requiring a key are omitted if that key is missing; the footer lists the missing sources.
Use `PROVIDERS=open-meteo,met-norway,...` to restrict the enabled providers.
`CONTACT` (an email address or URL) is included in the User-Agent header, as required by MET Norway.

## URL parameters

| Parameter | Meaning | Example |
|---|---|---|
| `q` | Place name | `?q=Szeged` |
| `lat`, `lon` | Coordinates; when present, `q` is only the display name | `?lat=47.5&lon=19.04` |
| `days` | Number of days, 1-7 (default: 3) | `&days=5` |
| `start` | Starting-day offset: 0 = today, 1 = tomorrow | `&start=1&days=1` |
| `lang` | `hu` or `en` | `&lang=en` |

Without an explicit location, the app uses browser geolocation. The last known position's cached
forecast appears immediately and then refreshes. On the first visit, a fallback city based on the
browser's time zone (such as Budapest) is used while waiting for location permission.
If access is denied or location lookup fails, the app explains the reason.

### Troubleshooting geolocation

- Browser geolocation requires **HTTPS** or `localhost`; an HTTP LAN address such as
  `http://192.168.1.10` will not work.
- Grant or reset location permission using the site controls beside the browser's address bar.
- On Windows, enable location services in **Settings > Privacy & security > Location**,
  including permission for desktop applications.
- Reverse geocoding through Nominatim (OpenStreetMap) requires **no API key**, but its usage policy
  requires an identifying User-Agent. Set `CONTACT` in `.env` or in Vercel's environment variables.
  The server spaces requests by at least 1.1 seconds within each instance and caches results.
  This is not a global rate limiter across Vercel instances; higher traffic requires shared
  throttling or another geocoding service to comply with the public Nominatim policy.

## Hourly breakdown (today and tomorrow)

Today's and tomorrow's cards include a collapsible **Hourly breakdown** section. Today's table
starts at the current local hour. Chart tabs switch between:

- **Temperature**, **Wind**, **Cloud cover**, and **Solar radiation**: thin colored lines show
  individual sources; the thick line shows their median. A dashed line on the wind chart shows
  median gusts.
- **Precipitation**: bars show the median amount in mm; the dashed line shows median probability
  on a separate 0-100% scale.

The table below shows hourly sky icons, temperature, precipitation probability and amount,
wind direction and speed, gusts, cloud cover, and radiation (W/m²).
Numeric values are source medians; wind direction uses a circular mean, and sky icons use a vote
with ties resolved in favor of the more severe condition. Hover over numeric cells to see values
from individual providers. Nighttime hours have a darker background and appropriate icons.
The app remembers the selected chart and the expanded/collapsed state.

Sources with multi-hour intervals are spread across their constituent hours, with precipitation
distributed evenly. These are not independent hourly predictions. Missing provider coverage is
excluded from the consensus rather than treated as zero.

## Units and the consensus row

- Temperature: daily minimum/maximum (°C). Precipitation: daily total (mm);
  probability: the highest value during the day (%).
- Wind: the strongest sustained wind during the day (km/h), with the prevailing direction
  indicating where the wind comes from. Gusts: daily maximum (km/h).
- Solar radiation: daily global radiation total (MJ/m²). Cloud cover: daily average (%).
- For sources supplying hourly or 3-hourly data, the server calculates daily values in the location's
  time zone. An asterisk (`*`) marks a partial day based only on the remaining forecast hours.
- **Consensus**: each numeric metric is the median of available sources; smaller text shows the
  range across sources. Wind direction is an unweighted circular mean; if sources disagree strongly,
  it is marked as variable. The daily sky icon is the most frequent icon, with ties resolved using
  median precipitation and cloud cover.
- Missing data is shown as a dash, not zero, and is excluded from the median.

## Performance

- One HTML response contains the CSS, JavaScript, and SVG icons; no external UI libraries or chart
  assets are needed.
- Forecasts are cached per provider and approximately 1 km coordinate grid cell using
  stale-while-revalidate. Identical simultaneous requests on the same instance share an upstream call.
- Cached forecasts are embedded directly in the initial HTML. Vercel instances can read them from
  Runtime Cache even when their local memory is empty.
- The browser also stores the last 12 locations in `localStorage`, for up to 24 hours, allowing
  immediate rendering on return visits followed by a refresh.
- Changing the forecast range does not trigger new API requests.

## Project structure

```text
server.js               Local HTTP server (npm start)
api/index.js            Vercel Function entry point and Runtime Cache integration
lib/app.js              Routes, page assembly, NDJSON streaming, and CSP
lib/cache.js            In-memory/shared cache, SWR, and request coalescing
lib/forecast.js         Concurrent providers, time zones, and cached snapshots
lib/aggregate.js        Hourly-to-daily aggregation in local time
lib/providers/*.js      Provider-specific URL construction and normalization
lib/geo.js              Place search (Open-Meteo) and reverse geocoding (Nominatim)
web/                    HTML, CSS, JavaScript, translations, icons, and consensus helpers
test/                   node:test unit tests
```

## License and attribution

See [LICENSE](LICENSE) for the application license.
Open-Meteo and MET Norway data are licensed under CC BY 4.0.
The footer links to every active source; Meteosource's free plan explicitly requires attribution.
