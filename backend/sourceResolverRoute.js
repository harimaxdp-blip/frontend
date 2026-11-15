import express from "express";

const router = express.Router();
const ARCHIVE_API = "https://archive.org/metadata/";
const MEDIA_EXTENSIONS = new Map([
  [".m3u8", "hls"], [".mpd", "dash"], [".mp4", "mp4"], [".webm", "webm"],
]);
const SUBTITLE_EXTENSIONS = new Set([".vtt", ".srt"]);
const TYPE_PRIORITY = { hls: 0, mp4: 1, webm: 2, dash: 3 };
const IDENTIFIER_RE = /^[a-zA-Z0-9_-]{1,80}$/;

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
router.get('/resolve', async (req, res) => {
  const identifier = getArchiveItemUrl(String(req.query.url || '').trim());
  if (!identifier) {
    return res.status(400).json({ status: 'fallback', reason: 'Only public Internet Archive item and embed pages can be resolved.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`${ARCHIVE_API}${encodeURIComponent(identifier)}`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('json')) {
      return res.json({ status: 'fallback', provider: 'Internet Archive', reason: 'The public metadata API did not return an accessible item.' });
    }

    const metadata = await readJsonWithLimit(response);

    const files = Array.isArray(metadata.files) ? metadata.files.filter(publicArchiveFile) : [];
    const playableFiles = files
      .map((file) => ({ file, type: MEDIA_EXTENSIONS.get(fileExtension(file.name)) }))
      .filter((entry) => entry.type)
      .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);
    const selected = playableFiles[0];
    if (!selected) {
      return res.json({ status: 'fallback', provider: 'Internet Archive', reason: 'No public MP4, HLS, DASH, or WebM file was listed for this item.' });
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
    return res.json({
      status: 'resolved', streamUrl, mediaType: selected.type,
      provider: 'Internet Archive',
      title: metadata.metadata?.title || identifier,
      subtitles,
      audioTracks: [],
    });
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? 'The provider metadata request timed out.'
      : 'The public provider metadata API is unavailable.';
    return res.json({ status: 'fallback', provider: 'Internet Archive', reason });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;  