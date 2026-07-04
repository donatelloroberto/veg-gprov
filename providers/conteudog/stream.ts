import { ProviderContext, Stream } from "../types";
import { BASE_URL, absoluteUrl, fetchText } from "./common";
import {
  extractPlayers,
  hostLabel,
  resolveEmbed,
  uniqueStreams,
} from "./extractors";

export const getStream = async function ({
  link,
  signal,
  providerContext,
}: {
  link: string;
  type: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Stream[]> {
  try {
    const input = absoluteUrl(link, `${BASE_URL}/`);
    let players: { server: string; embedUrl: string }[];

    if (/conteudog\.com\.br/i.test(input)) {
      const html = await fetchText({
        url: input,
        referer: `${BASE_URL}/`,
        signal,
        providerContext,
      });
      players = extractPlayers(html);
    } else {
      players = [{ server: hostLabel(input), embedUrl: input }];
    }

    const results = await Promise.all(
      players.map(async (player) => {
        try {
          return await resolveEmbed({
            embedUrl: player.embedUrl,
            server: player.server,
            signal,
            providerContext,
          });
        } catch (error) {
          console.error(`ConteudoG resolver failed for ${player.server}`, error);
          return [] as Stream[];
        }
      }),
    );

    return uniqueStreams(results.flat()).slice(0, 20);
  } catch (error) {
    console.error("ConteudoG getStream error", error);
    return [];
  }
};
