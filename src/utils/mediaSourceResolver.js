const PROXY_BASE = process.env.REACT_APP_MEDIA_PROXY_URL || "http://localhost:4000";
const ARCHIVE_HOSTS = new Set(["archive.org", "www.archive.org"]);
const ONESTREAM_HOSTS = new Set(["dub.onestream.today", "play.onestream.today"]);
const EMBED_ONLY_HOSTS = ["isaidub.me", "vidsrc.to", "doodstream.com", "streamtape.com", "filemoon.sx", "mixdrop.co", "voe.sx"];
const SUPPORTED_MEDIA_TYPES = new Set(["hls", "dash", "mp4", "webm", "mov", "ts", "remux", "ogv", "3gp"]);
const RESOLUTION_CACHE_LIMIT = 100;
const RESOLUTION_CACHE_TTL_MS = 5 * 60 * 1000;
const RESOLUTION_TIMEOUT_MS = 15000;
const resolutionCache = new Map();
const ONESTREAM_FASTBYTES_PATHS = new Map([
  ["download.fastbytes.xyz", "/download.php"],
  ["fastly.fastbytes.xyz", "/open.php"],
]);

const LANGUAGE_NAMES = {
  ta: "Tamil", tam: "Tamil", te: "Telugu", tel: "Telugu", hi: "Hindi", hin: "Hindi",
  en: "English", eng: "English", ml: "Malayalam", mal: "Malayalam", kn: "Kannada", kan: "Kannada",
  ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean", es: "Spanish", spa: "Spanish",
  fr: "French", fra: "French", de: "German", deu: "German",
};

export function normalizeLanguageLabel(rawLabel, rawLangCode, index = 0) {
  const code = String(rawLangCode || "").trim().toLowerCase().split("-")[0];
  const label = String(rawLabel || "").trim();
  if (label && !/^(und|unknown|audio|track|stream)\s*\d*$/i.test(label)) {
    const labelTokens = label.toLowerCase().replace(/[^a-z0-9-]+/g, " ").split(/\s+/);
    const labelLanguage = labelTokens.find((token) => LANGUAGE_NAMES[token]);
    return LANGUAGE_NAMES[labelLanguage] || LANGUAGE_NAMES[label.toLowerCase()] || label;
  }
  return LANGUAGE_NAMES[code] || `Audio Track ${index + 1}`;
}

export function validateHttpUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  const trimmed = rawUrl.trim();
  if (/^magnet:\?/i.test(trimmed)) return { valid: true, url: trimmed, isMagnet: true };
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return { valid: true, url: parsed.href, parsed };
  } catch {
    return null;
  }
}

function isOnestreamHost(host) {
  if (!host) return false;
  const lower = host.toLowerCase();
  return lower === "onestream.today" || lower.endsWith(".onestream.today");
}

export function identifyProvider(validated) {
  const host = validated?.parsed?.hostname?.toLowerCase();
  if (!host) return { id: "unknown", name: "External source", strategy: "fallback" };
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".youtube-nocookie.com")) {
    return { id: "youtube", name: "YouTube", strategy: "official_embed" };
  }
  if (ARCHIVE_HOSTS.has(host)) return { id: "archive", name: "Internet Archive", strategy: "public_metadata_api" };
  if (isOnestreamHost(host)) return { id: "onestream", name: "Onestream", strategy: "public_video_element" };
  if (EMBED_ONLY_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return { id: "embed_only", name: host, strategy: "embed_fallback" };
  }
  return { id: "external", name: host, strategy: "embed_fallback" };
}

const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|iso|torrent|exe|apk)(?:$|[?#])/i;
const ONESTREAM_DUBSHARE_HOST_RE = /^s\d+\.dubshare\.one$/i;

export function detectDirectMediaType(rawUrl, contentType = "") {
  if (typeof rawUrl !== "string") return null;
  const type = String(contentType).split(";")[0].trim().toLowerCase();
  if (type.includes("mpegurl")) return "hls";
  if (type === "application/dash+xml") return "dash";
  if (type.startsWith("video/")) {
    if (/matroska/.test(type)) return "remux";
    if (/mp2t/.test(type)) return "ts";
    if (/webm/.test(type)) return "webm";
    if (/quicktime/.test(type)) return "mov";
    return "mp4";
  }
  if (ARCHIVE_RE.test(rawUrl)) return "archive";
  let path = rawUrl;
  try { path = new URL(rawUrl).pathname; } catch {}
  if (/\.m3u8$/i.test(path)) return "hls";
  if (/\.mpd$/i.test(path)) return "dash";
  if (/\/hls\//i.test(path)) return "hls";
  if (/\/dash\//i.test(path)) return "dash";
  try {
    if (new URL(rawUrl).searchParams.get("stream") === "1") return "mp4";
  } catch {}
  if (/\.(mkv|avi|wmv|flv)$/i.test(path)) return "remux";
  const match = path.match(/\.(mp4|webm|mov|ts|ogv|3gp)$/i);
  if (match) return match[1].toLowerCase();
  return null;
}

function isAllowedOnestreamMedia(stream) {
  const parsed = stream?.parsed;
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443" && parsed.port !== "80")) return false;

  const host = parsed.hostname.toLowerCase();

  // Uptodub media hosts
  if (host === "dub.uptodub.ch" || host.endsWith(".uptodub.ch") || host === "uptodub.ch" || host.endsWith(".uptodub.com")) {
    return !/\/stream\/(?:video|page)\/\d+\/?$/i.test(parsed.pathname) &&
      !/\.(html?|json|txt)$/i.test(parsed.pathname);
  }

  // Fastbytes hosts
  if (host === "fastbytes.xyz" || host.endsWith(".fastbytes.xyz")) {
    return (parsed.pathname === "/download.php" || parsed.pathname === "/open.php" || parsed.pathname === "/stream.php" || parsed.pathname === "/play.php") &&
      (parsed.searchParams.get("stream") === "1" || Boolean(parsed.searchParams.get("dl")));
  }

  // isaidub host
  if (host === "download.isaidub.dad" || host.endsWith(".isaidub.dad") || host.endsWith(".isaidub.me")) {
    if ((parsed.pathname !== "/download.php" && parsed.pathname !== "/stream.php") || parsed.searchParams.get("stream") !== "1") return false;
    try {
      const nestedMedia = new URL(parsed.searchParams.get("url") || "");
      return ['https:', 'http:'].includes(nestedMedia.protocol) &&
        !nestedMedia.username && !nestedMedia.password &&
        (ONESTREAM_DUBSHARE_HOST_RE.test(nestedMedia.hostname.toLowerCase()) || nestedMedia.hostname.toLowerCase().endsWith(".dubshare.one")) &&
        (!nestedMedia.port || nestedMedia.port === "443" || nestedMedia.port === "80") &&
        /\.mp4$/i.test(nestedMedia.pathname);
    } catch {
      return false;
    }
  }

  // Onestream direct media URLs
  if (host === "onestream.today" || host.endsWith(".onestream.today")) {
    return !/\/stream\/(?:video|page)\/\d+\/?$/i.test(parsed.pathname) &&
      !/\.(html?|json|txt)$/i.test(parsed.pathname);
  }

  // Dubshare hosts
  if (host === "dubshare.one" || host.endsWith(".dubshare.one") || ONESTREAM_DUBSHARE_HOST_RE.test(host)) {
    return /\.mp4$/i.test(parsed.pathname);
  }

  return false;
}

async function probeMediaContentType(url, signal) {
  const request = createRequestController(signal, RESOLUTION_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      signal: request.signal,
    });
    if (!response.ok) return null;
    const finalUrl = validateHttpUrl(response.url || url);
    if (!finalUrl) return null;
    const mediaType = detectDirectMediaType(finalUrl.url, response.headers.get("content-type") || "");
    if (!mediaType || mediaType === "archive") return null;
    return { status: "resolved", streamUrl: finalUrl.url, mediaType, provider: "Direct Stream", subtitles: [], audioTracks: [] };
  } catch (error) {
    if (signal?.aborted) throw error;
    // CORS-blocked or unavailable sources remain in their provider's official embed.
    return null;
  } finally {
    request.dispose();
  }
}
function makeFallback(url, provider, reason, embedUrl = url) {
  return { status: "iframe_fallback", embedUrl, provider: provider.name, fallbackReason: reason };
}

function createRequestController(signal, timeoutMs) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  let timedOut = false;

  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function getCachedResult(key) {
  const entry = resolutionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    resolutionCache.delete(key);
    return null;
  }
  resolutionCache.delete(key);
  resolutionCache.set(key, entry);
  return entry.result;
}

function cacheResolvedResult(key, result) {
  const streamUrl = validateHttpUrl(result.streamUrl);
  if (!streamUrl || streamUrl.parsed.search) return result;
  if (resolutionCache.size >= RESOLUTION_CACHE_LIMIT) resolutionCache.delete(resolutionCache.keys().next().value);
  resolutionCache.set(key, {
    result,
    expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS,
  });
  return result;
}

export async function resolveMediaSource(rawUrl, { signal, preferNativeBridge = false } = {}) {
  const validated = validateHttpUrl(rawUrl);
  if (!validated) {
    return { status: "error", reason: "Only valid HTTP/HTTPS media URLs are supported." };
  }
  if (validated.isMagnet) return { status: "magnet", streamUrl: validated.url, provider: "BitTorrent Magnet" };

  const mediaType = detectDirectMediaType(validated.url);
  if (mediaType === "archive") {
    return { status: "unsupported", mediaType, reason: "Archive files cannot be streamed directly." };
  }
  if (mediaType) {
    return {
      status: "resolved", streamUrl: validated.url, mediaType, provider: "Direct Stream",
      useNativePlayer: Boolean(preferNativeBridge && ["mp4", "hls", "mov", "webm"].includes(mediaType)),
      subtitles: [], audioTracks: [],
    };
  }

  const provider = identifyProvider(validated);
  if (provider.id === "youtube") {
    const id = validated.url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/)?.[1];
    if (id) {
      const embedUrl = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;
      return makeFallback(validated.url, provider, "YouTube requires its official embedded player.", embedUrl);
    }
    return makeFallback(validated.url, provider, "The YouTube URL could not be identified for its official embed.");
  }

  // Only the fixed public Archive API and allowlisted Onestream pages are fetched.
  // Other providers are never fetched or scraped; their official embed remains the fallback.
  if (provider.id !== "archive" && provider.id !== "onestream") {
    if (provider.id !== "embed_only") {
      const probe = await probeMediaContentType(validated.url, signal);
      if (probe) return { ...probe, useNativePlayer: Boolean(preferNativeBridge) };
    }
    return makeFallback(validated.url, provider, "This provider does not expose a supported direct media API; its embed player is retained.");
  }
  if (provider.id === "archive") {
    const cachedResult = getCachedResult(validated.url);
    if (cachedResult) return cachedResult;
  }

  const request = createRequestController(signal, RESOLUTION_TIMEOUT_MS);
  try {
    const response = await fetch(`${PROXY_BASE}/api/resolve?url=${encodeURIComponent(validated.url)}`, {
      signal: request.signal,
    });
    const data = response.ok ? await response.json() : null;
    if (data?.status === "resolved" && typeof data.streamUrl === "string") {
      const stream = validateHttpUrl(data.streamUrl);
      const responseType = String(data.mediaType || "").toLowerCase();
      const resolvedType = stream &&
        (detectDirectMediaType(stream.url, data.contentType || "") ||
          (SUPPORTED_MEDIA_TYPES.has(responseType) ? responseType : null));
      const allowedProviderStream = provider.id !== "onestream" ||
        isAllowedOnestreamMedia(stream);
      if (stream && allowedProviderStream && resolvedType && resolvedType !== "archive") {
        const result = {
          status: "resolved", streamUrl: stream.url, mediaType: resolvedType,
          provider: data.provider || provider.name,
          referrerPolicy: data.referrerPolicy === "no-referrer" ? "no-referrer" : undefined,
          subtitles: Array.isArray(data.subtitles) ? data.subtitles.filter((sub) => validateHttpUrl(sub?.src)) : [],
          audioTracks: Array.isArray(data.audioTracks) ? data.audioTracks : [],
          useNativePlayer: Boolean(preferNativeBridge),
        };
        return provider.id === "archive"
          ? cacheResolvedResult(validated.url, result)
          : result;
      }
    }
    return makeFallback(
      validated.url, provider,
      data?.reason || "No public, supported media file was exposed by the provider API."
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return makeFallback(
      validated.url,
      provider,
      request.didTimeOut()
        ? "The provider resolver timed out; its embed player is retained."
        : "The provider API could not be reached; its embed player is retained."
    );
  } finally {
    request.dispose();
  }
}