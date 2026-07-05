import { ProviderContext, Stream } from "../types";
import {
  BASE_URL,
  USER_AGENT,
  absoluteUrl,
  fetchText,
  requestHeaders,
} from "./common";

const DEAD_HOST_RE = /(?:^|\.)(?:minochinos\.com)$/i;
const MEDIA_URL_RE = /(\.m3u8(?:\?|$)|\.mp4(?:\?|$)|\.mkv(?:\?|$)|\.webm(?:\?|$)|\/hls\/|\/manifest\/|\/video\/|\/file\/|\/media\/|get_video\?|videoplayback|\/stream\/|\/dl\?)/i;

export interface PlayerEntry {
  server: string;
  embedUrl: string;
}

type Quality = "360" | "480" | "720" | "1080" | "2160";

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match?.[1]) return String(match[1]).replace(/&amp;/g, "&");
  }
  return "";
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Server";
  }
}

function streamOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return BASE_URL;
  }
}

function qualityFromUrl(url: string): Quality | undefined {
  const match = /(2160|1080|720|480|360)p?/i.exec(url);
  return match?.[1] as Quality | undefined;
}

function streamType(url: string): string {
  if (/\.m3u8(?:\?|$)|\/hls\/|\/manifest\//i.test(url)) return "m3u8";
  if (/\.mkv(?:\?|$)/i.test(url)) return "mkv";
  if (/\.webm(?:\?|$)/i.test(url)) return "webm";
  return "mp4";
}

function isPlayableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && MEDIA_URL_RE.test(url);
}

function streamHeaders(
  referer: string,
  url: string,
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "*/*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: referer || `${streamOrigin(url)}/`,
    ...extraHeaders,
  };
}

function responseUrl(response: any, requestedUrl: string): string {
  const fromRequest =
    response?.request?.responseURL ||
    response?.request?.res?.responseUrl ||
    response?.request?._currentUrl;
  const location = response?.headers?.location;
  if (fromRequest) return String(fromRequest);
  if (location) return absoluteUrl(location, requestedUrl);
  return requestedUrl;
}

function bodyPrefix(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 500).toLowerCase();
  try {
    const bytes =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : null;
    if (!bytes) return "";
    let text = "";
    const max = Math.min(bytes.length, 500);
    for (let i = 0; i < max; i += 1) text += String.fromCharCode(bytes[i]);
    return text.toLowerCase();
  } catch {
    return "";
  }
}

function headerValue(headers: any, name: string): string {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return String(headers[key] ?? "");
  }
  return "";
}

function isProbablyMediaResponse(response: any, requestedUrl: string): boolean {
  const status = Number(response?.status || 0);
  if (status < 200 || status >= 400) return false;

  const finalUrl = responseUrl(response, requestedUrl);
  const contentType = headerValue(response?.headers, "content-type").toLowerCase();
  const prefix = bodyPrefix(response?.data);

  if (/^\s*<!doctype html|^\s*<html|<title>|<body|<script/i.test(prefix)) return false;
  if (/text\/html|application\/xhtml/.test(contentType)) return false;
  if (prefix.includes("#extm3u")) return true;
  if (/text\/plain/.test(contentType) && !/\.m3u8?(?:\?|$)/i.test(finalUrl)) return false;
  if (/video\/.+|audio\/.+|application\/(?:octet-stream|vnd\.apple\.mpegurl|x-mpegurl|mpegurl)/.test(contentType)) return true;
  return MEDIA_URL_RE.test(finalUrl) && !/text\/html/.test(contentType);
}

async function verifiedMediaUrl({
  url,
  referer,
  signal,
  providerContext,
}: {
  url: string;
  referer: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<string> {
  const target = absoluteUrl(url, referer || `${BASE_URL}/`);
  if (!isPlayableUrl(target)) return "";

  const isHls = /\.m3u8(?:\?|$)|\/hls\/|\/manifest\//i.test(target);
  const headers = streamHeaders(referer || target, target, {
    Accept: "*/*",
    ...(isHls ? {} : { Range: "bytes=0-1" }),
  });

  try {
    const response = await providerContext.axios.get(target, {
      signal,
      headers,
      responseType: isHls ? "text" : "arraybuffer",
      maxRedirects: 5,
      maxContentLength: 512 * 1024,
      validateStatus: () => true,
    });
    if (isProbablyMediaResponse(response, target)) return responseUrl(response, target);
  } catch (error) {
    console.log("ConteudoG range probe failed", hostLabel(target), String(error));
  }

  // Some file hosts reject Range GETs but expose a valid media Content-Type on HEAD.
  try {
    const response = await providerContext.axios.head(target, {
      signal,
      headers: streamHeaders(referer || target, target, { Accept: "*/*" }),
      maxRedirects: 5,
      validateStatus: () => true,
    });
    if (isProbablyMediaResponse(response, target)) return responseUrl(response, target);
  } catch (error) {
    console.log("ConteudoG HEAD probe failed", hostLabel(target), String(error));
  }

  return "";
}

function toStream(
  url: string,
  server: string,
  referer: string,
  extraHeaders: Record<string, string> = {},
): Stream {
  const quality = qualityFromUrl(url);
  return {
    server: quality ? `${server} ${quality}p` : server,
    link: url,
    type: streamType(url),
    quality,
    headers: streamHeaders(referer || url, url, extraHeaders),
  };
}

function dedupeStreams(streams: Stream[]): Stream[] {
  const seen = new Set<string>();
  return streams.filter((stream) => {
    const key = `${stream.server}|${stream.link}`;
    if (!stream?.link || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function candidatesToStreams({
  candidates,
  server,
  referer,
  signal,
  providerContext,
  extraHeaders = {},
}: {
  candidates: string[];
  server: string;
  referer: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  extraHeaders?: Record<string, string>;
}): Promise<Stream[]> {
  const output: Stream[] = [];
  const seen = new Set<string>();

  for (const raw of candidates) {
    const candidate = absoluteUrl(raw, referer || `${BASE_URL}/`);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);

    // Verification is best-effort only. Many supported hosts reject server-side
    // Range/HEAD probes while the same URL plays correctly in Vega with Referer.
    const checked = await verifiedMediaUrl({
      url: candidate,
      referer,
      signal,
      providerContext,
    });
    const playable = checked || candidate;
    output.push(toStream(playable, server || hostLabel(playable), referer, extraHeaders));
  }

  return dedupeStreams(output);
}

function encodeBaseN(value: number, base: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (base < 2 || base > alphabet.length) return value.toString(36);
  if (value === 0) return "0";
  let current = value;
  let output = "";
  while (current > 0) {
    output = alphabet[current % base] + output;
    current = Math.floor(current / base);
  }
  return output;
}

function unpackPackerSync(source: string): string {
  const match = /eval\(function\(p,a,c,k,e,(?:r|d)\)\{[\s\S]*?\}\(['"]([\s\S]*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([\s\S]*?)['"]\.split\(['"]\|['"]\)/.exec(source);
  if (!match) return "";

  let packed = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const radix = Number(match[2]);
  const count = Number(match[3]);
  const dictionary = match[4].split("|");

  for (let i = count - 1; i >= 0; i -= 1) {
    const word = dictionary[i];
    if (!word) continue;
    const token = encodeBaseN(i, radix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    packed = packed.replace(new RegExp(`\\b${token}\\b`, "g"), word);
  }
  return packed;
}

function extractIframeSrc(embedHtml: string): string {
  const match = /src\s*=\s*["']([^"']+)/i.exec(embedHtml.replace(/\\\//g, "/"));
  return match?.[1] ? absoluteUrl(match[1], `${BASE_URL}/`) : "";
}

export function extractPlayers(html: string): PlayerEntry[] {
  const players: PlayerEntry[] = [];
  const decodeHtml = (value: unknown): string =>
    String(value ?? "")
      .replace(/\\\//g, "/")
      .replace(/&quot;/gi, '"')
      .replace(/&#x27;|&#0?39;|&apos;/gi, "'")
      .replace(/&amp;/gi, "&")
      .trim();

  const knownLabel = (value: string): string => {
    const text = value.toLowerCase();
    if (/voe(?:stream)?/.test(text)) return "VoeStream";
    if (/vinovo/.test(text)) return "Vinovo";
    if (/mixdrop/.test(text)) return "MixDrop";
    if (/dood(?:stream)?/.test(text)) return "DoodStream";
    if (/streamtape/.test(text)) return "StreamTape";
    if (/filemoon/.test(text)) return "FileMoon";
    if (/streamwish/.test(text)) return "StreamWish";
    if (/vidhide/.test(text)) return "VidHide";
    if (/uqload/.test(text)) return "Uqload";
    if (/lulustream/.test(text)) return "LuluStream";
    if (/wolfstream/.test(text)) return "WolfStream";
    if (/playmogo/.test(text)) return "PlayMogo";
    return "";
  };

  const addPlayer = (serverValue: unknown, embedValue: unknown) => {
    const rawEmbed = decodeHtml(embedValue);
    const embedUrl = /<iframe\b/i.test(rawEmbed)
      ? extractIframeSrc(rawEmbed)
      : absoluteUrl(rawEmbed, `${BASE_URL}/`);
    if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return;
    if (players.some((player) => player.embedUrl === embedUrl)) return;
    const explicit = cleanPlayerLabel(decodeHtml(serverValue));
    players.push({
      server: explicit || knownLabel(embedUrl) || hostLabel(embedUrl) || `Player ${players.length + 1}`,
      embedUrl,
    });
  };

  const urlFromText = (value: string): string[] => {
    const decoded = decodeHtml(value);
    const urls: string[] = [];
    const re = /https?:\\?\/\\?\/[^\s"'<>),;]+/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(decoded)) !== null) {
      urls.push(match[0].replace(/\\\//g, "/"));
    }
    const iframeSrc = extractIframeSrc(decoded);
    if (iframeSrc) urls.push(iframeSrc);
    return urls;
  };

  // 1) Current/legacy ConteudoG JS arrays.
  const arrayMatch =
    /(?:const|let|var)\s+players\s*=\s*(\[[\s\S]*?\])\s*;/i.exec(html) ||
    /players\s*:\s*(\[[\s\S]*?\])/i.exec(html);

  if (arrayMatch?.[1]) {
    const source = arrayMatch[1];
    try {
      const parsed = JSON.parse(source);
      for (const entry of parsed) {
        addPlayer(entry?.servidor || entry?.server || entry?.name || entry?.title, entry?.embed || entry?.url || entry?.link || entry?.src);
      }
    } catch {
      const objectRegex = /\{([\s\S]*?)\}/g;
      let objectMatch: RegExpExecArray | null;
      while ((objectMatch = objectRegex.exec(source)) !== null) {
        const objectText = objectMatch[1];
        const serverMatch = /(?:servidor|server|name|title)\s*:\s*(["'])([\s\S]*?)\1/i.exec(objectText);
        const embedMatch = /(?:embed|url|link|src)\s*:\s*(["'])([\s\S]*?)\1/i.exec(objectText);
        if (embedMatch?.[2]) addPlayer(serverMatch?.[2], embedMatch[2]);
      }
    }
  }

  // 2) Object-map syntax, e.g. players = { vinovo: "https://...", mixdrop: "https://..." }.
  const mapRegex = /(?:const|let|var)?\s*(?:players|playerLinks|playerUrls|servidores|servers)\s*=\s*\{([\s\S]*?)\}\s*;?/gi;
  let mapMatch: RegExpExecArray | null;
  while ((mapMatch = mapRegex.exec(html)) !== null) {
    const body = mapMatch[1];
    const pairRegex = /["']?([\w.-]+)["']?\s*:\s*(["'])([\s\S]*?)\2/g;
    let pair: RegExpExecArray | null;
    while ((pair = pairRegex.exec(body)) !== null) addPlayer(pair[1], pair[3]);
  }

  // 3) Player tabs/buttons. ConteudoG swaps #player-area when a tab is clicked,
  // so inspect onclick and data-* payloads instead of only the active iframe.
  const tagRegex = /<(button|a|div|span)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const attrs = tagMatch[2] || "";
    const inner = tagMatch[3] || "";
    const visibleText = cleanPlayerLabel(inner.replace(/<[^>]+>/g, " "));
    const label = knownLabel(visibleText) || visibleText;

    const attrPayloads: string[] = [];
    const attrRe = /(?:onclick|data-(?:src|url|link|embed|player|iframe|video|server-url))\s*=\s*(["'])([\s\S]*?)\1/gi;
    let attr: RegExpExecArray | null;
    while ((attr = attrRe.exec(attrs)) !== null) attrPayloads.push(attr[2]);

    for (const payload of attrPayloads) {
      for (const url of urlFromText(payload)) addPlayer(label || knownLabel(payload), url);
    }
  }

  // 4) Known host URLs embedded anywhere in inline JavaScript. This catches
  // tab handlers that keep URLs in switch/case blocks or function calls.
  const hostUrlRegex = /https?:\\?\/\\?\/[^\s"'<>]+(?:voe|vinovo|mixdrop|dood|streamtape|filemoon|streamwish|vidhide|uqload|lulustream|wolfstream|playmogo)[^\s"'<>]*/gi;
  let hostUrlMatch: RegExpExecArray | null;
  while ((hostUrlMatch = hostUrlRegex.exec(html)) !== null) {
    const url = hostUrlMatch[0].replace(/\\\//g, "/");
    addPlayer(knownLabel(url), url);
  }

  // 5) Generic quoted URLs on supported embed-style paths, useful when the
  // hostname appears before the path and does not match the regex above.
  const embedUrlRegex = /(["'])(https?:\\?\/\\?\/[^"']+\/(?:e|embed|v|d)\/[^"']+)\1/gi;
  let embedUrlMatch: RegExpExecArray | null;
  while ((embedUrlMatch = embedUrlRegex.exec(html)) !== null) {
    const url = embedUrlMatch[2].replace(/\\\//g, "/");
    addPlayer(knownLabel(url), url);
  }

  // 6) Active/default iframe and lazy iframe fallbacks.
  const iframeRegex = /<iframe\b[^>]*(?:src|data-src)\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
  let iframeMatch: RegExpExecArray | null;
  while ((iframeMatch = iframeRegex.exec(html)) !== null) {
    addPlayer(knownLabel(iframeMatch[1]) || hostLabel(iframeMatch[1]), iframeMatch[1]);
  }

  return players;
}

function cleanPlayerLabel(value: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function collectPlayableCandidates(text: string, embedUrl: string): string[] {
  const candidates: string[] = [];
  const normalized = String(text || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const patterns = [
    /["']?(?:file|src|source|video|url|hls)["']?\s*[:=]\s*["']([^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm)[^"']*)["']/gi,
    /sources\s*[:=]\s*\[[\s\S]{0,1600}?["']?file["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /jwplayer\([^)]*\)\.setup\s*\([\s\S]{0,2500}?["']?file["']?\s*:\s*["']([^"']+)["']/gi,
    /<source\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi,
    /["'](https?:\/\/[^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm|videoplayback|\/hls\/|\/stream\/|\/media\/|\/dl\?)[^"']*)["']/gi,
    /["'](\/[^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm|videoplayback|\/hls\/|\/stream\/|\/media\/|\/dl\?)[^"']*)["']/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      if (match[1]) candidates.push(absoluteUrl(match[1], embedUrl));
    }
  }

  candidates.push(...decodePotentialMediaStrings(normalized, embedUrl));
  return candidates.filter(isPlayableUrl);
}

function safeBase64Decode(value: string): string {
  const globalAtob = (globalThis as any)?.atob;
  if (typeof globalAtob === "function") {
    try {
      return globalAtob(value.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      // Continue to pure-JS fallback.
    }
  }

  try {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const input = value.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
    let output = "";
    let buffer = 0;
    let bits = 0;
    for (const char of input) {
      if (char === "=") break;
      const index = alphabet.indexOf(char);
      if (index < 0) continue;
      buffer = (buffer << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    return output;
  } catch {
    return "";
  }
}

function rot13(value: string): string {
  return value.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function shiftChars(value: string, offset: number): string {
  return value.replace(/[\s\S]/g, (char) => String.fromCharCode(char.charCodeAt(0) + offset));
}

function decodePotentialMediaStrings(text: string, embedUrl: string): string[] {
  const output: string[] = [];
  const seenOutput = new Set<string>();
  const quoted: string[] = [];
  const quotedRegex = /["']([A-Za-z0-9+/_=-]{32,})["']/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedRegex.exec(text)) !== null && quoted.length < 80) {
    quoted.push(quotedMatch[1]);
  }

  const collect = (value: string) => {
    const matches =
      value.match(/https?:\/\/[^"'<>\s\\]+(?:\.m3u8|\.mp4|\.mkv|\.webm|\/hls\/|\/stream\/|\/media\/|videoplayback)[^"'<>\s\\]*/gi) || [];
    for (const match of matches) {
      const resolved = absoluteUrl(match, embedUrl);
      if (!seenOutput.has(resolved)) {
        seenOutput.add(resolved);
        output.push(resolved);
      }
    }
  };

  for (const raw of quoted) {
    const queue = [raw];
    const localSeen = new Set<string>();
    for (let index = 0; index < queue.length && index < 80; index += 1) {
      const current = queue[index];
      if (!current || localSeen.has(current) || current.length > 8000) continue;
      localSeen.add(current);
      collect(current);
      const variants = [
        safeBase64Decode(current),
        safeBase64Decode(rot13(current)),
        safeBase64Decode(current.split("").reverse().join("")),
        current.split("").reverse().join(""),
        rot13(current),
        shiftChars(current, -1),
        shiftChars(current, 1),
      ];
      for (const variant of variants) {
        if (variant && !localSeen.has(variant) && queue.length < 80) queue.push(variant);
      }
    }
  }

  return output;
}

function extractHiddenInputs(html: string): string {
  const params: string[] = [];
  const inputRegex = /<input\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0];
    const name = firstMatch(tag, [
      /name\s*=\s*["']([^"']+)["']/i,
      /name\s*=\s*([^\s>]+)/i,
    ]);
    const value = firstMatch(tag, [
      /value\s*=\s*["']([^"']*)["']/i,
      /value\s*=\s*([^\s>]+)/i,
    ]);
    if (name) params.push(`${encodeURIComponent(name)}=${encodeURIComponent(value || "")}`);
  }
  return params.join("&");
}

async function unpackMaybe(body: string): Promise<string> {
  const local = unpackPackerSync(body);
  return local ? `${body}\n${local}` : body;
}

async function resolveMixDrop(
  embedUrl: string,
  server: string,
  signal: AbortSignal | undefined,
  providerContext: ProviderContext,
): Promise<Stream[]> {
  const body = await fetchText({ url: embedUrl, referer: `${BASE_URL}/`, signal, providerContext });
  const text = await unpackMaybe(body);
  const candidates: string[] = [];
  const patterns = [
    /wurl\s*=\s*["']([^"']+)["']/i,
    /MDCore\.wurl\s*=\s*["']([^"']+)["']/i,
    /(?:file|src)\s*:\s*["']([^"']+(?:\.mp4|\.m3u8)[^"']*)["']/i,
    /["'](https?:\/\/[^"']+(?:\.mp4|\.m3u8)[^"']*)["']/i,
    /["'](\/[^"']+(?:\.mp4|\.m3u8)[^"']*)["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text) || pattern.exec(body);
    if (match?.[1]) candidates.push(absoluteUrl(match[1], embedUrl));
  }
  return candidatesToStreams({
    candidates: candidates.filter(isPlayableUrl),
    server: server || "MixDrop",
    referer: embedUrl,
    signal,
    providerContext,
  });
}

async function resolveVoe(
  embedUrl: string,
  server: string,
  signal: AbortSignal | undefined,
  providerContext: ProviderContext,
): Promise<Stream[]> {
  const body = await fetchText({ url: embedUrl, referer: `${BASE_URL}/`, signal, providerContext });
  const text = await unpackMaybe(body);
  const candidates: string[] = [];
  const patterns = [
    /["']hls["']\s*:\s*["']([^"']+)["']/i,
    /hls\s*[:=]\s*["']([^"']+)["']/i,
    /file\s*[:=]\s*["']([^"']+(?:\.m3u8|\.mp4)[^"']*)["']/i,
    /source\s*[:=]\s*["']([^"']+(?:\.m3u8|\.mp4)[^"']*)["']/i,
    /sources\s*[:=]\s*[\[{][\s\S]*?["']?file["']?\s*:\s*["']([^"']+)["']/i,
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) candidates.push(absoluteUrl(match[1], embedUrl));
  }
  candidates.push(...decodePotentialMediaStrings(text, embedUrl));
  return candidatesToStreams({
    candidates: candidates.filter(isPlayableUrl),
    server: server || "Voe",
    referer: embedUrl,
    signal,
    providerContext,
  });
}

function deobfuscateStreamTapeString(raw: string): string {
  let value = String(raw || "")
    .replace(/&amp;/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\s+/g, "")
    .trim();
  if (!value) return "";

  value = value.replace(/^["'`]+|["'`;<>]+$/g, "");
  value = value.replace(/(https?:\/\/)?streamtape\.com[a-z0-9_-]{1,40}(?=\/)/gi, (_all, scheme) => `${scheme || ""}streamtape.com`);
  value = value.replace(/(\/\/)?streamtape\.com[a-z0-9_-]{1,40}(?=\/)/gi, (_all, slash) => `${slash || ""}streamtape.com`);
  value = value.replace(/\/get_vi[\w-]*deo(?=\?)/gi, "/get_video");
  value = value.replace(/\/get_vide?o(?=\?)/gi, "/get_video");
  value = value.replace(/([?&])(?:[a-z]{2,24})?(id|expires|ip|token|stream)=/gi, "$1$2=");
  value = value.replace(/([?&])stream=1(&|$)/i, "$1").replace(/[?&]$/, "");
  return value;
}

function normalizeStreamTapeUrl(raw: string, embedUrl: string): string {
  let value = deobfuscateStreamTapeString(raw);
  if (!value) return "";
  if (value.startsWith("//")) value = `https:${value}`;
  if (/^streamtape\.com\//i.test(value)) value = `https://${value}`;
  if (value.startsWith("/")) value = new URL(value, "https://streamtape.com/").toString();
  if (!/^https?:\/\//i.test(value)) value = absoluteUrl(value, embedUrl || "https://streamtape.com/");
  value = deobfuscateStreamTapeString(value);

  try {
    const parsed = new URL(value);
    if (!/^streamtape\.com$/i.test(parsed.hostname)) return "";
    parsed.protocol = "https:";
    parsed.hostname = "streamtape.com";
    parsed.pathname = parsed.pathname.replace(/\/get_vi[\w-]*deo/gi, "/get_video");

    const id = parsed.searchParams.get("id");
    const expires = parsed.searchParams.get("expires");
    const ip = parsed.searchParams.get("ip");
    const token = parsed.searchParams.get("token");
    if (parsed.pathname === "/get_video" && id && expires && ip && token) {
      return `https://streamtape.com/get_video?id=${encodeURIComponent(id)}&expires=${encodeURIComponent(expires)}&ip=${encodeURIComponent(ip)}&token=${encodeURIComponent(token)}`;
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function collectStreamTapeUrls(body: string, embedUrl: string): string[] {
  const raw = String(body || "").replace(/&amp;/g, "&").replace(/\\\//g, "/");
  const output: string[] = [];
  let match: RegExpExecArray | null;

  const fullRegex = /(?:https?:)?\/\/streamtape\.com[a-z0-9_-]{0,40}\/get_vi[\w-]*deo\?[^"'<>\s\\]+/gi;
  while ((match = fullRegex.exec(raw)) !== null) output.push(normalizeStreamTapeUrl(match[0], embedUrl));

  const relativeRegex = /\/get_vi[\w-]*deo\?[^"'<>\s\\]+/gi;
  while ((match = relativeRegex.exec(raw)) !== null) {
    output.push(normalizeStreamTapeUrl(`https://streamtape.com${match[0]}`, embedUrl));
  }

  const cleaned = deobfuscateStreamTapeString(raw);
  const paramsRegex = /id=([a-z0-9]+)&expires=([0-9]+)&ip=([A-Za-z0-9_-]+)&token=([A-Za-z0-9_-]+)/gi;
  while ((match = paramsRegex.exec(cleaned)) !== null) {
    output.push(`https://streamtape.com/get_video?id=${match[1]}&expires=${match[2]}&ip=${match[3]}&token=${match[4]}`);
  }

  const concatRegex = /["'`]([^"'`]{0,180}(?:streamtape\.com|\/get_vi)[^"'`]{0,240})["'`]\s*\+\s*["'`]([^"'`]{0,240})["'`]/gi;
  while ((match = concatRegex.exec(raw)) !== null) {
    output.push(normalizeStreamTapeUrl(`${match[1] || ""}${match[2] || ""}`, embedUrl));
  }

  return output.map((url) => normalizeStreamTapeUrl(url, embedUrl)).filter(Boolean);
}

async function resolveStreamTape(
  embedUrl: string,
  server: string,
  signal: AbortSignal | undefined,
  providerContext: ProviderContext,
): Promise<Stream[]> {
  const body = await fetchText({ url: embedUrl, referer: `${BASE_URL}/`, signal, providerContext });
  const candidates = collectStreamTapeUrls(body, embedUrl);
  const directRegex = /["'](https?:\/\/[^"']+(?:\.mp4|\.m3u8)[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = directRegex.exec(body)) !== null) candidates.push(match[1]);

  return candidatesToStreams({
    candidates: candidates.map((url) => normalizeStreamTapeUrl(url, embedUrl) || url),
    server: server || "StreamTape",
    referer: embedUrl,
    signal,
    providerContext,
  });
}

async function postAndCollect({
  url,
  body,
  referer,
  signal,
  providerContext,
}: {
  url: string;
  body: string;
  referer: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<string[]> {
  try {
    const response = await providerContext.axios.post(url, body, {
      signal,
      headers: {
        ...requestHeaders(referer, providerContext.commonHeaders),
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: streamOrigin(url),
        Referer: referer,
      },
      responseType: "text",
      validateStatus: (status: number) => status >= 200 && status < 400,
    });
    const responseBody = String(response.data ?? "");
    return collectPlayableCandidates(await unpackMaybe(responseBody), url);
  } catch {
    return [];
  }
}

async function resolveXFileSharing(
  embedUrl: string,
  server: string,
  signal: AbortSignal | undefined,
  providerContext: ProviderContext,
): Promise<Stream[]> {
  const body = await fetchText({ url: embedUrl, referer: `${BASE_URL}/`, signal, providerContext });
  let candidates = collectPlayableCandidates(await unpackMaybe(body), embedUrl);

  const codeMatch =
    /\/(?:embed|e|v|d)\/([a-z0-9]+)(?:[/?#]|$)/i.exec(embedUrl) ||
    /\/([a-z0-9]{8,})(?:[/?#]|$)/i.exec(embedUrl);

  if (codeMatch?.[1]) {
    const origin = streamOrigin(embedUrl);
    const alternates = [
      `${origin}/d/${codeMatch[1]}`,
      `${origin}/download/${codeMatch[1]}`,
      `${origin}/${codeMatch[1]}`,
    ];

    for (const alternate of alternates) {
      try {
        const alternateBody = await fetchText({
          url: alternate,
          referer: embedUrl,
          signal,
          providerContext,
        });
        candidates.push(...collectPlayableCandidates(await unpackMaybe(alternateBody), alternate));

        const payload = extractHiddenInputs(alternateBody);
        if (payload && /(?:op=|id=|fname=|hash=)/i.test(payload)) {
          candidates.push(
            ...(await postAndCollect({
              url: alternate,
              body: payload,
              referer: alternate,
              signal,
              providerContext,
            })),
          );
        }
      } catch {
        // Try next alternate.
      }
    }
  }

  const originalPayload = extractHiddenInputs(body);
  if (originalPayload && /(?:op=|id=|fname=|hash=)/i.test(originalPayload)) {
    candidates.push(
      ...(await postAndCollect({
        url: embedUrl,
        body: originalPayload,
        referer: embedUrl,
        signal,
        providerContext,
      })),
    );
  }

  return candidatesToStreams({
    candidates,
    server: server || hostLabel(embedUrl),
    referer: embedUrl,
    signal,
    providerContext,
  });
}

async function resolveGeneric(
  embedUrl: string,
  server: string,
  signal: AbortSignal | undefined,
  providerContext: ProviderContext,
): Promise<Stream[]> {
  const body = await fetchText({ url: embedUrl, referer: `${BASE_URL}/`, signal, providerContext });
  const candidates = collectPlayableCandidates(await unpackMaybe(body), embedUrl);
  return candidatesToStreams({
    candidates,
    server: server || hostLabel(embedUrl),
    referer: embedUrl,
    signal,
    providerContext,
  });
}

export async function resolveEmbed({
  embedUrl,
  server,
  signal,
  providerContext,
}: {
  embedUrl: string;
  server: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Stream[]> {
  const host = hostLabel(embedUrl).toLowerCase();
  if (DEAD_HOST_RE.test(host) || /minochinos/.test(host)) return [];
  if (/mxdrop|mixdrop/.test(host)) return resolveMixDrop(embedUrl, server || "MixDrop", signal, providerContext);
  if (/voe/.test(host)) return resolveVoe(embedUrl, server || "Voe", signal, providerContext);
  if (/streamtape/.test(host)) return resolveStreamTape(embedUrl, server || "StreamTape", signal, providerContext);
  if (/vinovo|playmogo/.test(host)) return resolveXFileSharing(embedUrl, server || hostLabel(embedUrl), signal, providerContext);
  if (/earnvids|filemoon|streamwish|vidhide|uqload|dood|lulustream|wolfstream/.test(host)) {
    return resolveXFileSharing(embedUrl, server || hostLabel(embedUrl), signal, providerContext);
  }
  return resolveGeneric(embedUrl, server || hostLabel(embedUrl), signal, providerContext);
}

export function uniqueStreams(streams: Stream[]): Stream[] {
  return dedupeStreams(streams);
}
