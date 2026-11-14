import express from "express";
import cors from "cors";
import { spawn, execFile } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import WebTorrent from "webtorrent";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 4000;
const HLS_ROOT = path.join(os.tmpdir(), "hari-movies-hls");
fs.mkdirSync(HLS_ROOT, { recursive: true });

const activeJobs = new Map();
const wtClient = new WebTorrent();
const activeTorrents = new Map();

const LANG_NAMES = {
  tam: "Tamil", ta: "Tamil",
  tel: "Telugu", te: "Telugu",
  hin: "Hindi", hi: "Hindi",
  eng: "English", en: "English",
  mal: "Malayalam", ml: "Malayalam",
  kan: "Kannada", kn: "Kannada",
  jpn: "Japanese", ja: "Japanese",
  kor: "Korean", ko: "Korean",
  spa: "Spanish", es: "Spanish",
};

const FILENAME_LANG_RULES = [
  { re: /\b(tam|tamil)\b/i, label: "Tamil", lang: "ta" },
  { re: /\b(tel|telugu)\b/i, label: "Telugu", lang: "te" },
  { re: /\b(hin|hindi)\b/i, label: "Hindi", lang: "hi" },
  { re: /\b(eng|english)\b/i, label: "English", lang: "en" },
  { re: /\b(mal|malayalam)\b/i, label: "Malayalam", lang: "ml" },
  { re: /\b(kan|kannada)\b/i, label: "Kannada", lang: "kn" },
  { re: /\b(jap|japanese)\b/i, label: "Japanese", lang: "ja" },
  { re: /\b(kor|korean)\b/i, label: "Korean", lang: "ko" },
  { re: /\b(spa|spanish)\b/i, label: "Spanish", lang: "es" },
];

function extractLangsFromUrl(url) {
  try {
    const clean = decodeURIComponent(url.split("?")[0]).replace(/[_.\-+]+/g, " ");
    return FILENAME_LANG_RULES.filter((r) => r.re.test(clean));
  } catch {
    return [];
  }
}

function formatLangLabel(tags, idx, urlFallbackLangs) {
  const title = (tags?.title || "").trim();
  if (title && !/^(track|audio|stream|stereo|surround|5\.1|dd5\.1)\s*\d*$/i.test(title)) {
    return title;
  }
  const code = (tags?.language || "").toLowerCase();
  if (LANG_NAMES[code]) return LANG_NAMES[code];
  if (urlFallbackLangs[idx]) return urlFallbackLangs[idx].label;
  return `Audio ${idx + 1}`;
}

// Clean up stale HLS sessions older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  try {
    for (const entry of fs.readdirSync(HLS_ROOT)) {
      const fullPath = path.join(HLS_ROOT, entry);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff && !activeJobs.has(entry)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  } catch {}
}, 30 * 60 * 1000);

// ─── 1. Magnet Link Stream Endpoint (HTTP Range Streaming) ───────────────────
function getOrAddTorrent(magnetUri) {
  return new Promise((resolve, reject) => {
    const existing = activeTorrents.get(magnetUri);
    if (existing && existing.ready) return resolve(existing);

    const timeout = setTimeout(() => reject(new Error("Torrent metadata timeout")), 35000);

    wtClient.add(magnetUri, { path: path.join(HLS_ROOT, "torrents") }, (torrent) => {
      clearTimeout(timeout);
      const videoExts = /\.(mp4|mkv|webm|avi|mov|m4v|ts)$/i;
      const videoFiles = torrent.files.filter((f) => videoExts.test(f.name));
      const targetFile = (videoFiles.length ? videoFiles : torrent.files).sort(
        (a, b) => b.length - a.length
      )[0];

      if (!targetFile) return reject(new Error("No playable video file found in magnet"));

      const entry = { torrent, file: targetFile, ready: true };
      activeTorrents.set(magnetUri, entry);
      resolve(entry);
    });
  });
}

app.get("/api/magnet/info", async (req, res) => {
  const magnet = req.query.magnet;
  if (!magnet) return res.status(400).json({ error: "Missing magnet" });
  try {
    const { file } = await getOrAddTorrent(magnet);
    const streamUrl = `http://localhost:${PORT}/api/magnet/stream?magnet=${encodeURIComponent(magnet)}`;
    res.json({
      fileName: file.name,
      size: file.length,
      streamUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/magnet/stream", async (req, res) => {
  const magnet = req.query.magnet;
  if (!magnet) return res.status(400).end();
  try {
    const { file } = await getOrAddTorrent(magnet);
    const total = file.length;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": file.name.endsWith(".mkv") ? "video/x-matroska" : "video/mp4",
      });
      const stream = file.createReadStream({ start, end });
      stream.pipe(res);
      req.on("close", () => stream.destroy());
    } else {
      res.writeHead(200, {
        "Content-Length": total,
        "Content-Type": file.name.endsWith(".mkv") ? "video/x-matroska" : "video/mp4",
      });
      const stream = file.createReadStream();
      stream.pipe(res);
      req.on("close", () => stream.destroy());
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ─── 2. Probe Video Duration, Resolution, Audio & Subtitle Tracks ────────────
app.get("/api/probe", (req, res) => {
  const mediaUrl = req.query.url;
  if (!mediaUrl) return res.status(400).json({ error: "Missing url" });

  execFile(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", mediaUrl],
    { timeout: 25000 },
    (err, stdout) => {
      if (err) {
        return res.status(500).json({ error: "ffprobe failed", details: err.message });
      }
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        const durations = [
          parseFloat(data.format?.duration || "0"),
          ...streams.map((stream) => parseFloat(stream.duration || "0")),
        ].filter((duration) => Number.isFinite(duration) && duration > 0);
        const totalDuration = durations.length ? Math.max(...durations) : 0;
        const urlFallbackLangs = extractLangsFromUrl(mediaUrl);

        const videoStream = streams.find((s) => s.codec_type === "video");
        const sourceQuality = videoStream?.height ? `${videoStream.height}p (Original)` : "Original";

        const audioTracks = streams
          .filter((s) => s.codec_type === "audio")
          .map((s, idx) => ({
            id: idx,
            streamIndex: s.index,
            lang: s.tags?.language || urlFallbackLangs[idx]?.lang || "und",
            label: formatLangLabel(s.tags, idx, urlFallbackLangs),
            codec: s.codec_name,
          }));

        const subtitleTracks = streams
          .filter(
            (s) =>
              s.codec_type === "subtitle" &&
              !["hdmv_pgs_subtitle", "dvd_subtitle"].includes(s.codec_name)
          )
          .map((s, idx) => ({
            id: idx,
            streamIndex: s.index,
            lang: s.tags?.language || "en",
            label:
              s.tags?.title ||
              LANG_NAMES[(s.tags?.language || "").toLowerCase()] ||
              `Subtitle ${idx + 1}`,
          }));

        res.json({ totalDuration, sourceQuality, audioTracks, subtitleTracks });
      } catch {
        res.status(500).json({ error: "Failed to parse stream metadata" });
      }
    }
  );
});

// ─── 3. Extract Embedded MKV Subtitle Stream as WebVTT (.vtt) ────────────────
app.get("/api/subtitle.vtt", (req, res) => {
  const { url: mediaUrl, track = "0", streamIndex } = req.query;
  if (!mediaUrl) return res.status(400).end();

  const parsedStreamIndex = Number(streamIndex);
  const streamMap = Number.isInteger(parsedStreamIndex) && parsedStreamIndex >= 0
    ? `0:${parsedStreamIndex}`
    : `0:s:${track}`;
  const hash = crypto.createHash("md5").update(`${mediaUrl}-sub-${streamMap}`).digest("hex");
  const cachedVtt = path.join(HLS_ROOT, `${hash}.vtt`);

  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (fs.existsSync(cachedVtt) && fs.statSync(cachedVtt).size > 20) {
    return fs.createReadStream(cachedVtt).pipe(res);
  }

  const ff = spawn("ffmpeg", [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", mediaUrl,
    "-map", streamMap,
    "-f", "webvtt",
    "pipe:1",
  ]);

  const chunks = [];
  ff.stdout.on("data", (chunk) => {
    chunks.push(chunk);
    res.write(chunk);
  });

  ff.stdout.on("end", () => {
    res.end();
    const full = Buffer.concat(chunks);
    if (full.length > 20) {
      fs.writeFile(cachedVtt, full, () => {});
    }
  });

  ff.stderr.on("data", () => {});
  req.on("close", () => {
    try { ff.kill("SIGKILL"); } catch {}
  });
});

// ─── 4. Live-Remux Video + Selected Audio Track Preserving Timeline Offset ───
app.get("/api/hls/master.m3u8", async (req, res) => {
  const mediaUrl = req.query.url;
  const audioIdx = Number(req.query.audio || 0);
  const startSec = Math.max(0, Math.floor(Number(req.query.start || 0)));
  if (!mediaUrl) return res.status(400).send("Missing url");

  const hash = crypto
    .createHash("md5")
    .update(`${mediaUrl}-a${audioIdx}-s${startSec}`)
    .digest("hex");
  const outDir = path.join(HLS_ROOT, hash);
  const playlistPath = path.join(outDir, "index.m3u8");

  if (!activeJobs.has(hash) && !fs.existsSync(playlistPath)) {
    fs.mkdirSync(outDir, { recursive: true });

    const args = [
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      ...(startSec > 0 ? ["-ss", String(startSec)] : []),
      "-i", mediaUrl,
      "-map", "0:v:0",
      "-map", `0:a:${audioIdx}?`,
      "-c:v", "copy",
      "-c:a", "aac",
      "-ac", "2",
      "-b:a", "192k",
      ...(startSec > 0 ? ["-output_ts_offset", String(startSec)] : []),
      "-f", "hls",
      "-hls_time", "4",
      "-hls_list_size", "0",
      "-hls_flags", "independent_segments",
      "-hls_segment_filename", path.join(outDir, "seg_%05d.ts"),
      playlistPath,
    ];

    const proc = spawn("ffmpeg", args);
    activeJobs.set(hash, proc);
    proc.stderr.on("data", () => {});
    proc.on("exit", () => activeJobs.delete(hash));
  }

  const waitStart = Date.now();
  while (!fs.existsSync(playlistPath) && Date.now() - waitStart < 18000) {
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!fs.existsSync(playlistPath)) {
    return res.status(504).send("Stream initialization timed out");
  }

  res.redirect(`/api/hls-files/${hash}/index.m3u8`);
});

app.use("/api/hls-files", express.static(HLS_ROOT));

app.listen(PORT, () => {
  console.log(`Media Proxy running on http://localhost:${PORT}`);
});