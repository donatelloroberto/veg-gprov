# Architecture analysis and conversion decisions

## Vega provider contract

The target repository builds each provider folder into independent `catalog`, `posts`, `meta`, `stream`, and optional `episodes` bundles. The shared `ProviderContext` supplies HTTP (`axios`), HTML parsing (`cheerio`), common headers, and optional base-URL helpers.

## Why no `episodes.ts`

The supplied ConteudoG plugin exposes each item as one movie-like playable page. Vega already supports this through `Info.linkList[].directLinks[]`; therefore the item page is returned directly from metadata and handed to `getStream()`.

## Key runtime changes

1. Callback APIs were converted to async Promise-returning Vega functions.
2. SkyStream-specific model constructors were replaced with Vega `Post`, `Info`, and `Stream` objects.
3. `MAGIC_PROXY_v1 + btoa(url)` was removed because Vega's stream contract expects the actual URL; request headers are carried in `Stream.headers`.
4. The supplied player/host extractor logic was preserved in `extractors.ts` and adapted to `ProviderContext.axios`.
5. Catalog filters follow the site's current routes and current pagination form, for example `/Videos&pagina=2`.
