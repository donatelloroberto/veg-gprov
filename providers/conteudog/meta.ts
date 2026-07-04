import { Info, Link, ProviderContext } from "../types";
import {
  BASE_URL,
  DEFAULT_POSTER,
  absoluteUrl,
  cleanText,
  fetchText,
  parsePostsFromHtml,
  slugFromUrl,
} from "./common";

async function findPosterForPage(
  pageUrl: string,
  providerContext: ProviderContext,
): Promise<string> {
  const slug = slugFromUrl(pageUrl);
  if (!slug) return DEFAULT_POSTER;

  const pages = ["/", "/Videos", "/Cenas", "/Filmes"];
  for (const path of pages) {
    try {
      const html = await fetchText({
        url: `${BASE_URL}${path}`,
        referer: `${BASE_URL}/`,
        providerContext,
      });
      const match = parsePostsFromHtml({ html, providerContext }).find(
        (post) => slugFromUrl(post.link) === slug,
      );
      if (match?.image) return match.image;
    } catch {
      // Continue through fallback pages.
    }
  }
  return DEFAULT_POSTER;
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const pageUrl = absoluteUrl(link, `${BASE_URL}/`);

  try {
    const html = await fetchText({
      url: pageUrl,
      referer: `${BASE_URL}/`,
      providerContext,
    });
    const $ = providerContext.cheerio.load(html);

    const title = cleanText(
      $(".titulo-filme").first().clone().children().remove().end().text() ||
        $(".titulo-filme").first().text() ||
        $("h1").first().text() ||
        $("title").first().text().replace(/\s+-\s+Conteudo G$/i, ""),
    ) || "ConteudoG Video";

    const tags: string[] = Array.from(
      new Set<string>(
        $(".rodape a")
          .map((_index: number, element: any) => cleanText($(element).text()))
          .get()
          .filter(Boolean),
      ),
    );

    const cast: string[] = Array.from(
      new Set<string>(
        $("a.ator-card .ator-nome, .ator-card .ator-nome")
          .map((_index: number, element: any) => cleanText($(element).text()))
          .get()
          .filter(Boolean),
      ),
    );

    let image = absoluteUrl(
      $("meta[property='og:image']").attr("content") ||
        $("img.front-cover").first().attr("src") ||
        "",
      pageUrl,
    );
    if (!image || image.includes("/imagens/logo")) {
      image = await findPosterForPage(pageUrl, providerContext);
    }

    const directLinks: NonNullable<Link["directLinks"]> = [
      {
        title: "Play",
        link: pageUrl,
        type: "movie",
      },
    ];

    return {
      title,
      image: image || DEFAULT_POSTER,
      synopsis: tags.length ? `Tags: ${tags.join(", ")}` : "ConteudoG video.",
      imdbId: "",
      type: "movie",
      tags,
      cast,
      linkList: [
        {
          title: "Available Players",
          directLinks,
        },
      ],
    };
  } catch (error) {
    console.error("ConteudoG getMeta error", error);
    return {
      title: "ConteudoG Video",
      image: DEFAULT_POSTER,
      synopsis: "ConteudoG video.",
      imdbId: "",
      type: "movie",
      tags: [],
      cast: [],
      linkList: [
        {
          title: "Available Players",
          directLinks: [{ title: "Play", link: pageUrl, type: "movie" }],
        },
      ],
    };
  }
};
