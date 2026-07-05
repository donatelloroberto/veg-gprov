# v4 fixes

- Replaced permissive StreamTape token scraping with exact `#ideoooolink` + `#norobotlink` reconstruction.
- Converts `/e/` StreamTape pages to `/v/` before extraction when applicable.
- Stops fabricating token variants from unrelated `id/expires/ip/token` fragments.
- Resolves `get_video` through redirects and returns only the final verified media URL.
- Removes raw short-lived `get_video` fallbacks that produced duplicate non-playing entries.
- Deduplicates streams by final URL rather than `server + URL`.
