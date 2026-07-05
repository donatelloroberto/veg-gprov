# ConteudoG Vega Provider v2 fixes

- Exposes every discovered host as an individual `directLinks` player in `getMeta`.
- Sends the selected embed URL directly to `getStream`, matching Vega's direct-link flow.
- Parses strict JSON and JavaScript object-literal `players` arrays.
- Supports normal and lazy (`data-src`) iframes.
- Changes media validation from mandatory to best-effort: anti-hotlink hosts that reject server-side Range/HEAD probes are no longer discarded before Vega attempts playback.
- Preserves per-stream Referer and User-Agent headers.
