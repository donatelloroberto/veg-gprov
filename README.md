# ConteudoG provider for `Zenda-Cross/vega-providers`

This is a Vega-provider port of the supplied SkyStream ConteudoG v5 plugin.

## Files

Copy this directory into the target repository:

```text
providers/conteudog/
  catalog.ts
  common.ts
  extractors.ts
  meta.ts
  posts.ts
  stream.ts
```

`episodes.ts` is intentionally omitted. ConteudoG items are handled as movie-like direct links: `getMeta()` returns the ConteudoG item page in `directLinks`, and Vega passes that URL to `getStream()`.

## Manifest

Append the object from `manifest-entry.json` to the repository root `manifest.json` array.

## Build and test

From the `vega-providers` repository root:

```bash
npm install
npm run build
npm run test -- conteudog
```

Targeted tests:

```bash
npm run test:provider conteudog getPosts
npm run test:provider conteudog getSearchPosts
npm run test:provider conteudog getMeta
npm run test:provider conteudog getStream
```

Local app testing:

```bash
npm run auto
```

## Architecture mapping

| SkyStream v5 plugin | Vega provider |
|---|---|
| `getHome()` | `catalog.ts` + `getPosts()` |
| `search()` | `getSearchPosts()` |
| `load()` | `getMeta()` |
| `loadStreams()` | `getStream()` |
| `MultimediaItem` | `Post` / `Info` |
| `StreamResult` | `Stream` |
| `MAGIC_PROXY_v1...` | Removed; direct URL + `Stream.headers` |

## Preserved extractor behavior

- MixDrop unpacking and media extraction
- Voe direct/decoded source discovery
- StreamTape URL de-junking and canonical `get_video` reconstruction
- Vinovo and PlayMogo XFileSharing-style fallbacks
- Dood/FileMoon/StreamWish/VidHide/Uqload/LuluStream/WolfStream generic XFS handling
- hidden-form POST fallback
- dead-host skip for `minochinos.com`
- response probing that rejects HTML landing/error pages before returning a stream
