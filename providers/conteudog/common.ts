import { Post, ProviderContext } from "../types";

export const BASE_URL = "https://conteudog.com.br";
export const DEFAULT_POSTER = `${BASE_URL}/imagens/logo.png`;
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+Clique para Assistir$/i, "")
    .trim();
}

export function absoluteUrl(value: unknown, referer = `${BASE_URL}/`): string {
  if (!value) return "";
  let raw = String(value).trim().replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (!raw) return "";
  if (raw.startsWith("//")) raw = `https:${raw}`;
  try {
    return new URL(raw, referer).toString();
  } catch {
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${BASE_URL}/${raw.replace(/^\/+/, "")}`;
  }
}

export function requestHeaders(
  referer = `${BASE_URL}/`,
  commonHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    ...commonHeaders,
    "User-Agent": commonHeaders["User-Agent"] || USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: referer,
  };
}

export async function fetchText({
  url,
  referer,
  signal,
  providerContext,
}: {
  url: string;
  referer?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<string> {
  const target = absoluteUrl(url, referer || `${BASE_URL}/`);
  const response = await providerContext.axios.get(target, {
    signal,
    headers: requestHeaders(referer || `${BASE_URL}/`, providerContext.commonHeaders),
    responseType: "text",
    validateStatus: (status: number) => status >= 200 && status < 400,
  });
  return String(response.data ?? "");
}

export function pagedFilterUrl(filter: string, page: number): string {
  const normalized = filter.startsWith("/") ? filter : `/${filter}`;
  if (!page || page <= 1) return `${BASE_URL}${normalized}`;
  return `${BASE_URL}${normalized}&pagina=${page}`;
}

export function parsePostsFromHtml({
  html,
  providerContext,
}: {
  html: string;
  providerContext: ProviderContext;
}): Post[] {
  const $ = providerContext.cheerio.load(html);
  const posts: Post[] = [];
  const seen = new Set<string>();

  $("a.video-card").each((_index: number, element: any) => {
    const node = $(element);
    const href = node.attr("href") || "";
    const link = absoluteUrl(href, `${BASE_URL}/`);
    if (!link || seen.has(link)) return;

    const title = cleanText(
      node.attr("title") ||
        node.find(".truncate-title").first().text() ||
        node.find("p").first().text(),
    );
    const image = absoluteUrl(
      node.find("img.front-cover").first().attr("src") ||
        node.find("img").first().attr("src") ||
        DEFAULT_POSTER,
      link,
    );

    if (!title) return;
    seen.add(link);
    posts.push({ title, link, image: image || DEFAULT_POSTER, provider: "conteudog" });
  });

  return posts;
}

export function uniquePosts(posts: Post[]): Post[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    if (!post?.link || seen.has(post.link)) return false;
    seen.add(post.link);
    return true;
  });
}

export function slugFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return url.split("/").filter(Boolean).pop() || "";
  }
}
