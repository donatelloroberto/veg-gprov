# ConteudoG Vega provider v3 fixes

- Detects player URLs from tab/button `onclick` handlers.
- Detects player URLs from `data-src`, `data-url`, `data-link`, `data-embed`, `data-player`, `data-iframe`, `data-video`, and `data-server-url` attributes.
- Detects object-map player definitions such as `players = { vinovo: "...", mixdrop: "..." }`.
- Detects supported embed-host URLs embedded anywhere in inline JavaScript.
- Detects generic quoted `/e/`, `/embed/`, `/v/`, and `/d/` embed URLs.
- Still detects the active/default `#player-area iframe` and generic iframe fallbacks.
- Deduplicates the same player URL across tab definitions and the active iframe.
- Normalizes escaped URLs such as `https:\/\/host\/e\/id`.
- Assigns stable labels for VoeStream, Vinovo, MixDrop, DoodStream, StreamTape, FileMoon, StreamWish, VidHide, Uqload, LuluStream, WolfStream, and PlayMogo.
