import { Post, ProviderContext } from "../types";
import {
  BASE_URL,
  fetchText,
  pagedFilterUrl,
  parsePostsFromHtml,
  uniquePosts,
} from "./common";

export const getPosts = async function ({
  filter,
  page,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    const html = await fetchText({
      url: pagedFilterUrl(filter || "/Videos", page),
      referer: `${BASE_URL}/`,
      signal,
      providerContext,
    });
    return parsePostsFromHtml({ html, providerContext });
  } catch (error) {
    console.error("ConteudoG getPosts error", error);
    return [];
  }
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return [];

  const filters = [
    "/Videos",
    "/Cenas",
    "/Filmes",
    "/Videos&opcao=Destaques",
    "/Videos&opcao=Lancamentos",
  ];

  try {
    const batches = await Promise.all(
      filters.map(async (filter) => {
        try {
          const html = await fetchText({
            url: pagedFilterUrl(filter, page || 1),
            referer: `${BASE_URL}/`,
            signal,
            providerContext,
          });
          return parsePostsFromHtml({ html, providerContext });
        } catch {
          return [] as Post[];
        }
      }),
    );

    return uniquePosts(batches.flat())
      .filter((post) => {
        const title = post.title.toLowerCase();
        const slugQuery = query.replace(/\s+/g, "-");
        return title.includes(query) || post.link.toLowerCase().includes(slugQuery);
      })
      .slice(0, 80);
  } catch (error) {
    console.error("ConteudoG getSearchPosts error", error);
    return [];
  }
};
