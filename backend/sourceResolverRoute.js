import express from "express";

const router = express.Router();
const ARCHIVE_API = "https://archive.org/metadata/";
const MEDIA_EXTENSIONS = new Map([
  [".m3u8", "hls"], [".mpd", "dash"], [".mp4", "mp4"], [".webm", "webm"],
]);
const SUBTITLE_EXTENSIONS = new Set([".vtt", ".srt"]);
const TYPE_PRIORITY = { hls: 0, mp4: 1, webm: 2, dash: 3 };
const IDENTIFIER_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const ONESTREAM_PAGE_ROUTES = new Map([
  ["dub.onestream.today", /^\/stream\/video\/(\d+)\/?$/],
  ["play.onestream.today", /^\/stream\/page\/(\d+)\/?$/],
]);
const ONESTREAM_MEDIA_HOST = "dub.uptodub.ch";
const ONESTREAM_DOWNLOAD_HOST = "download.isaidub.dad";
const ONESTREAM_FASTBYTES_PATHS = new Map([
  ["download.fastbytes.xyz", "/download.php"],
  ["fastly.fastbytes.xyz", "/open.php"],
]);
const ONESTREAM_DUBSHARE_HOST_RE = /^s\d+\.dubshare\.one$/i;
const MAX_PROVIDER_PAGE_BYTES = 2_000_000;

function getArchiveItemUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  if (!['archive.org', 'www.archive.org'].includes(parsed.hostname.toLowerCase())) return null;
  const match = parsed.pathname.match(/^\/(?:details|embed)\/([^/]+)\/?$/);
  if (!match) return null;
  let identifier;
  try { identifier = decodeURIComponent(match[1]); } catch { return null; }
  return IDENTIFIER_RE.test(identifier) ? identifier : null;
}

function getOnestreamPage(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443" && parsed.port !== "80")) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "onestream.today" || host.endsWith(".onestream.today")) {
    const match = parsed.pathname.match(/^\/stream\/(page|video)\/(\d+)\/?$/i);
    if (match) {
      return { host, route: match[1].toLowerCase(), videoId: match[2] };
    }
  }
  return null;
}

function encodeArchiveFile(name) {
  return String(name).split('/').map(encodeURIComponent).join('/');
}

function publicArchiveFile(file) {
  return !file?.private && String(file?.private).toLowerCase() !== 'true' && !String(file?.source || '').startsWith('metadata');
}

function fileExtension(name) {
  const match = String(name || '').match(/\.[^.\/]+$/);
  return match ? match[0].toLowerCase() : '';
}

async function readJsonWithLimit(response, maxBytes = 2_000_000) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('Metadata response too large');
  if (!response.body) return JSON.parse(await response.text());
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Metadata response too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function readTextWithLimit(response, maxBytes = MAX_PROVIDER_PAGE_BYTES) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('Provider page too large');
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Provider page too large');
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Provider page too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&#x0*26;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function parseTagAttributes(tag) {
  const attributes = Object.create(null);
  const content = tag.replace(/^<\s*[a-z][a-z0-9:-]*\b/i, '').replace(/\/?>\s*$/, '');
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = attributePattern.exec(content))) {
    attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function getOnestreamMediaType(sourceUrl, declaredType) {
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443" && parsed.port !== "80")) return null;

  const host = parsed.hostname.toLowerCase();
  const extension = fileExtension(parsed.pathname);
  if ([".html", ".htm", ".json", ".txt"].includes(extension)) return null;

  // 1. isaidub download host (download.isaidub.dad or *.isaidub.dad / *.isaidub.me)
  if (host === "download.isaidub.dad" || host.endsWith(".isaidub.dad") || host.endsWith(".isaidub.me")) {
    if ((parsed.pathname === "/download.php" || parsed.pathname === "/stream.php") && parsed.searchParams.get("stream") === "1") {
      let nestedMedia;
      try { nestedMedia = new URL(parsed.searchParams.get("url") || ""); } catch { return null; }
      if (['https:', 'http:'].includes(nestedMedia.protocol) && !nestedMedia.username && !nestedMedia.password &&
          (ONESTREAM_DUBSHARE_HOST_RE.test(nestedMedia.hostname.toLowerCase()) || nestedMedia.hostname.toLowerCase().endsWith(".dubshare.one")) &&
          (!nestedMedia.port || nestedMedia.port === "443" || nestedMedia.port === "80") &&
          /\.mp4$/i.test(nestedMedia.pathname)) {
        return "mp4";
      }
    }
    return null;
  }

  // 2. Fastbytes hosts (download.fastbytes.xyz, fastly.fastbytes.xyz, or any *.fastbytes.xyz)
  if (host === "fastbytes.xyz" || host.endsWith(".fastbytes.xyz")) {
    if ((parsed.pathname === "/download.php" || parsed.pathname === "/open.php" || parsed.pathname === "/stream.php" || parsed.pathname === "/play.php") &&
        (parsed.searchParams.get("stream") === "1" || Boolean(parsed.searchParams.get("dl")))) {
      return "mp4";
    }
    return null;
  }

  // 3. Uptodub media hosts (dub.uptodub.ch, *.uptodub.ch, uptodub.ch, etc.)
  if (host === "uptodub.ch" || host.endsWith(".uptodub.ch") || host === "uptodub.com" || host.endsWith(".uptodub.com")) {
    const extensionType = MEDIA_EXTENSIONS.get(extension);
    if (extensionType) return extensionType;

    const mimeType = String(declaredType || '').split(';')[0].trim().toLowerCase();
    if (mimeType.startsWith('video/mp4')) return 'mp4';
    if (mimeType.startsWith('video/webm')) return 'webm';
    if (mimeType.includes('mpegurl')) return 'hls';
    if (mimeType === 'application/dash+xml') return 'dash';

    if (parsed.searchParams.get("stream") === "1" || parsed.searchParams.has("dl") || parsed.pathname.includes("/hls/") || parsed.pathname.includes("/stream/")) {
      return "mp4";
    }
    return null;
  }

  // 4. Onestream direct stream files (e.g. dub.onestream.today, play.onestream.today, *.onestream.today)
  if (host === "onestream.today" || host.endsWith(".onestream.today")) {
    if (parsed.pathname.match(/^\/stream\/(?:page|video)\/\d+\/?$/i)) return null;

    const extensionType = MEDIA_EXTENSIONS.get(extension);
    if (extensionType) return extensionType;

    if (parsed.searchParams.get("stream") === "1" || parsed.searchParams.has("dl")) return "mp4";
    return null;
  }

  // 5. Dubshare hosts
  if (host === "dubshare.one" || host.endsWith(".dubshare.one") || ONESTREAM_DUBSHARE_HOST_RE.test(host)) {
    const extensionType = MEDIA_EXTENSIONS.get(extension);
    if (extensionType) return extensionType;
    if (extension === ".mp4") return "mp4";
    return null;
  }

  return null;
}

function findOnestreamVideoSource(html, pageUrl) {
  const documentMarkup = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');

  const candidates = [];
  const addCandidate = (src, type = '') => {
    if (typeof src === 'string' && src.trim()) {
      candidates.push({ src: decodeHtmlAttribute(src.trim()), type });
    }
  };

  // 1. Video blocks and source tags
  const videoBlocks = documentMarkup.match(/<video\b[^>]*>[\s\S]*?(?:<\/video\s*>|$)/gi) || [];
  for (const block of videoBlocks) {
    const openingTag = block.match(/^<video\b[^>]*>/i)?.[0];
    if (!openingTag) continue;
    const videoAttributes = parseTagAttributes(openingTag);
    for (const key of ["src", "data-src", "data-file", "data-video", "data-url", "data-mp4", "data-hls"]) {
      addCandidate(videoAttributes[key], videoAttributes.type);
    }
    for (const sourceTag of block.match(/<source\b[^>]*>/gi) || []) {
      const attributes = parseTagAttributes(sourceTag);
      for (const key of ["src", "data-src", "data-file", "data-url"]) {
        addCandidate(attributes[key], attributes.type);
      }
    }
  }

  // 2. Standalone <source> or <video> tags outside video blocks
  const standaloneSources = documentMarkup.match(/<(?:source|video)\b[^>]*>/gi) || [];
  for (const tag of standaloneSources) {
    const attributes = parseTagAttributes(tag);
    for (const key of ["src", "data-src", "data-file", "data-url", "data-video"]) {
      addCandidate(attributes[key], attributes.type);
    }
  }

  // 3. <iframe> and <embed> tags
  const frameTags = documentMarkup.match(/<(?:iframe|embed)\b[^>]*>/gi) || [];
  for (const tag of frameTags) {
    const attributes = parseTagAttributes(tag);
    for (const key of ["src", "data-src", "data-file", "data-url"]) {
      addCandidate(attributes[key], attributes.type);
    }
  }

  // 4. Meta and link tags (og:video, twitter:player:stream, etc.)
  const hintTags = documentMarkup.match(/<(?:meta|link)\b[^>]*>/gi) || [];
  for (const tag of hintTags) {
    const attributes = parseTagAttributes(tag);
    const hint = `${attributes.property || attributes.name || ""} ${attributes.rel || ""} ${attributes.as || ""}`.toLowerCase();
    if (/og:video|twitter:player:stream/.test(hint)) {
      addCandidate(attributes.content || attributes.href, attributes.type);
    } else if (/preload/.test(hint) && /video/.test(hint)) {
      addCandidate(attributes.href, attributes.type);
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate.src, pageUrl);
      const mediaType = getOnestreamMediaType(parsed.href, candidate.type);
      if (mediaType) return { streamUrl: parsed.href, mediaType };
    } catch {
      // Ignore malformed or non-URL markup values.
    }
  }
  return null;
}

async function resolveOnestreamPage({ host, route = "page", videoId }, visited = new Set()) {
  const currentRoute = route || "page";
  const pageUrl = `https://${host}/stream/${currentRoute}/${videoId}`;
  if (visited.has(pageUrl)) {
    return {
      status: 'iframe_fallback',
      provider: 'Onestream',
      reason: 'Circular page redirect detected.',
    };
  }
  visited.add(pageUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(pageUrl, {
      headers: { Accept: 'text/html' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      if (currentRoute === "page") {
        return resolveOnestreamPage({ host, route: "video", videoId }, visited);
      }
      return {
        status: 'iframe_fallback',
        provider: 'Onestream',
        reason: 'The provider page did not expose a public HTML video source.',
      };
    }

    const html = await readTextWithLimit(response);
    let source = findOnestreamVideoSource(html, pageUrl);

    if (!source) {
      const iframeMatches = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/gi) || [];
      for (const iframeTag of iframeMatches) {
        const srcAttr = iframeTag.match(/src=["']([^"']+)["']/i)?.[1];
        if (srcAttr) {
          try {
            const iframeUrl = new URL(decodeHtmlAttribute(srcAttr), pageUrl).href;
            const nestedPage = getOnestreamPage(iframeUrl);
            if (nestedPage && !visited.has(`https://${nestedPage.host}/stream/${nestedPage.route}/${nestedPage.videoId}`)) {
              const nestedResult = await resolveOnestreamPage(nestedPage, visited);
              if (nestedResult.status === "resolved") return nestedResult;
            }
          } catch {}
        }
      }
    }

    if (!source) {
      return {
        status: 'iframe_fallback',
        provider: 'Onestream',
        reason: 'No supported public MP4, HLS, or DASH source was declared in the provider page markup. The provider may use a nested player or protected/dynamically generated playback.',
      };
    }

    return {
      status: 'resolved',
      streamUrl: source.streamUrl,
      mediaType: source.mediaType,
      provider: 'Onestream',
      ...(host.startsWith("play.") || currentRoute === "page" ? { referrerPolicy: "no-referrer" } : {}),
      subtitles: [],
      audioTracks: [],
    };
  } catch (error) {
    if (currentRoute === "page") {
      const altUrl = `https://${host}/stream/video/${videoId}`;
      if (!visited.has(altUrl)) {
        try {
          const altResult = await resolveOnestreamPage({ host, route: "video", videoId }, visited);
          if (altResult.status === "resolved") return altResult;
        } catch {}
      }
    }
    return {
      status: 'iframe_fallback',
      provider: 'Onestream',
      reason: error?.name === 'AbortError'
        ? 'The provider page request timed out.'
        : 'The public provider page could not be resolved.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

router.get('/resolve', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  const identifier = getArchiveItemUrl(rawUrl);
  if (identifier) {
    return res.json(await resolveArchiveItem(identifier));
  }

  const onestreamPage = getOnestreamPage(rawUrl);
  if (onestreamPage) {
    return res.json(await resolveOnestreamPage(onestreamPage));
  }

  return res.status(400).json({
    status: 'fallback',
    reason: 'Only public Internet Archive items and supported Onestream pages can be resolved.',
  });
});

async function resolveArchiveItem(identifier) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`${ARCHIVE_API}${encodeURIComponent(identifier)}`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('json')) {
      return { status: 'fallback', provider: 'Internet Archive', reason: 'The public metadata API did not return an accessible item.' };
    }

    const metadata = await readJsonWithLimit(response);

    const files = Array.isArray(metadata.files) ? metadata.files.filter(publicArchiveFile) : [];
    const playableFiles = files
      .map((file) => ({ file, type: MEDIA_EXTENSIONS.get(fileExtension(file.name)) }))
      .filter((entry) => entry.type)
      .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);
    const selected = playableFiles[0];
    if (!selected) {
      return { status: 'fallback', provider: 'Internet Archive', reason: 'No public MP4, HLS, DASH, or WebM file was listed for this item.' };
    }

    const subtitles = files
      .filter((file) => SUBTITLE_EXTENSIONS.has(fileExtension(file.name)))
      .slice(0, 20)
      .map((file, index) => ({
        src: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeArchiveFile(file.name)}`,
        label: file.language || file.name.replace(/\.[^.]+$/, '') || `Subtitle ${index + 1}`,
        lang: file.language || '',
      }));
    const streamUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeArchiveFile(selected.file.name)}`;
    return {
      status: 'resolved', streamUrl, mediaType: selected.type,
      provider: 'Internet Archive',
      title: metadata.metadata?.title || identifier,
      subtitles,
      audioTracks: [],
    };
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? 'The provider metadata request timed out.'
      : 'The public provider metadata API is unavailable.';
    return { status: 'fallback', provider: 'Internet Archive', reason };
  } finally {
    clearTimeout(timeout);
  }
}

export default router;  