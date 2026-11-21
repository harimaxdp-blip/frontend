import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import WebTorrent from "webtorrent";
import { pipeline } from "stream/promises";
import sourceResolverRoute from "./sourceResolverRoute.js";

const app = express();
app.use(cors());
app.use("/api", sourceResolverRoute);

const PORT = process.env.PORT || 4000;
const HLS_ROOT = path.join(os.tmpdir(), "hari-movies-hls");
fs.mkdirSync(HLS_ROOT, { recursive: true });

const FFPROBE_TIMEOUT_MS = readNonNegativeIntegerEnv("FFPROBE_TIMEOUT_MS", 300000);
const PROBE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_PROBE_CACHE_ENTRIES = 128;
const MAX_PROBE_STDOUT_BYTES = 32 * 1024 * 1024;
const PROBE_CANCEL_GRACE_MS = 1000;
const PROBE_KILL_GRACE_MS = 5000;

const FFMPEG_HTTP_ARGS = [
  "-user_agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

const activeJobs = new Map();
const wtClient = new WebTorrent();
const activeTorrents = new Map();
const activeTorrentLoads = new Map();
const activeProbes = new Map();
const probeCache = new Map();

const CLIENT_DISCONNECT_CODES = new Set([
  "ABORT_ERR",
  "ECONNRESET",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
  "PREMATURE_CLOSE",
]);

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

function monitorClient(req, res, onDisconnect) {
  let disconnected = Boolean(req.aborted || res.destroyed);

  const markDisconnected = () => {
    if (disconnected) return;
    disconnected = true;
    onDisconnect?.();
  };
  const onRequestAborted = () => markDisconnected();
  const onResponseClose = () => {
    if (!res.writableFinished) markDisconnected();
  };

  req.once("aborted", onRequestAborted);
  res.once("close", onResponseClose);
  if (disconnected) onDisconnect?.();

  return {
    get disconnected() {
      return disconnected;
    },
    dispose() {
      req.removeListener("aborted", onRequestAborted);
      res.removeListener("close", onResponseClose);
    },
  };
}

function isClientDisconnectError(error) {
  return (
    CLIENT_DISCONNECT_CODES.has(error?.code) ||
    (error?.killed && ["SIGTERM", "SIGKILL"].includes(error.signal)) ||
    error?.name === "AbortError"
  );
}

function logStreamError(context, error, disconnected) {
  if (disconnected && isClientDisconnectError(error)) {
    const reason = error.code || error.signal || error.name || "cancelled";
    console.info(`[${context}] Client disconnected; stream cancelled (${reason}).`);
    return;
  }
  console.error(`[${context}] Stream failed:`, error);
}

function getVideoContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".mkv") return "video/x-matroska";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".ts") return "video/mp2t";
  return "video/mp4";
}

function parseByteRange(header, total) {
  if (!header) return { type: "full" };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return { type: "full" };
  if (!Number.isSafeInteger(total) || total <= 0) return { type: "unsatisfiable" };

  const [, startText, endText] = match;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { type: "unsatisfiable" };
    }
    return {
      type: "range",
      start: Math.max(0, total - suffixLength),
      end: total - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : total - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= total ||
    start > requestedEnd
  ) {
    return { type: "unsatisfiable" };
  }

  return { type: "range", start, end: Math.min(requestedEnd, total - 1) };
}

function sendStreamFailure(res, status, message) {
  if (res.destroyed) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(status).send(message);
}

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

function readNonNegativeIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return defaultValue;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) {
    throw new RangeError(`${name} must be an integer from 0 to 2147483647`);
  }
  return value;
}

function buildProbeData(data, mediaUrl) {
  const streams = data.streams || [];
  const durations = [
    parseFloat(data.format?.duration || "0"),
    ...streams.map((stream) => parseFloat(stream.duration || "0")),
  ].filter((duration) => Number.isFinite(duration) && duration > 0);
  const totalDuration = durations.length ? Math.max(...durations) : 0;
  const urlFallbackLangs = extractLangsFromUrl(mediaUrl);

  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const videoCodec = (videoStream?.codec_name || "").toLowerCase();
  const sourceQuality = videoStream?.height ? `${videoStream.height}p (Original)` : "Original";

  const audioTracks = streams
    .filter((stream) => stream.codec_type === "audio")
    .map((stream, idx) => ({
      id: idx,
      streamIndex: stream.index,
      lang: stream.tags?.language || urlFallbackLangs[idx]?.lang || "und",
      label: formatLangLabel(stream.tags, idx, urlFallbackLangs),
      codec: stream.codec_name,
    }));

  const subtitleTracks = streams
    .filter(
      (stream) =>
        stream.codec_type === "subtitle" &&
        !["hdmv_pgs_subtitle", "dvd_subtitle"].includes(stream.codec_name)
    )
    .map((stream, idx) => ({
      id: idx,
      streamIndex: stream.index,
      lang: stream.tags?.language || "en",
      label:
        stream.tags?.title ||
        LANG_NAMES[(stream.tags?.language || "").toLowerCase()] ||
        `Subtitle ${idx + 1}`,
    }));

  return { totalDuration, sourceQuality, videoCodec, audioTracks, subtitleTracks };
}

function getCachedProbe(mediaUrl) {
  const cached = probeCache.get(mediaUrl);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    probeCache.delete(mediaUrl);
    return null;
  }

  probeCache.delete(mediaUrl);
  probeCache.set(mediaUrl, cached);
  return cached.data;
}

function cacheProbe(mediaUrl, data) {
  probeCache.delete(mediaUrl);
  probeCache.set(mediaUrl, { data, expiresAt: Date.now() + PROBE_CACHE_TTL_MS });
  while (probeCache.size > MAX_PROBE_CACHE_ENTRIES) {
    probeCache.delete(probeCache.keys().next().value);
  }
}

function terminateProbe(job, reason) {
  if (
    job.state !== "running" ||
    job.abortReason ||
    !job.child ||
    job.child.exitCode !== null ||
    job.child.signalCode !== null
  ) {
    return;
  }
  job.abortReason = reason;
  job.controller.abort();
  job.killTimer = setTimeout(() => {
    const child = job.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch (err) {
        console.error("[ffprobe] Unable to force-stop the aborted process:", err);
      }
    }
  }, PROBE_KILL_GRACE_MS);
  job.killTimer.unref?.();
}

function subscribeToProbe(job) {
  if (job.cancelTimer) {
    clearTimeout(job.cancelTimer);
    job.cancelTimer = null;
  }
  job.subscribers += 1;
}

function releaseProbe(job) {
  if (!job || job.subscribers === 0) return;
  job.subscribers -= 1;
  if (job.subscribers !== 0 || job.state !== "running") return;

  job.cancelTimer = setTimeout(() => {
    job.cancelTimer = null;
    if (
      job.subscribers === 0 &&
      job.state === "running" &&
      job.child?.exitCode === null &&
      job.child?.signalCode === null
    ) {
      terminateProbe(job, "client-disconnect");
    }
  }, PROBE_CANCEL_GRACE_MS);
  job.cancelTimer.unref?.();
}

function getOrStartProbe(mediaUrl) {
  const existing = activeProbes.get(mediaUrl);
  if (existing?.state === "running" && !existing.abortReason) return existing;

  const job = {
    state: "running",
    subscribers: 0,
    cancelTimer: null,
    killTimer: null,
    abortReason: null,
    controller: new AbortController(),
    child: null,
    promise: null,
  };

  activeProbes.set(mediaUrl, job);
  job.promise = new Promise((resolve, reject) => {
    let stdoutBytes = 0;
    const stdoutChunks = [];
    let stderr = Buffer.alloc(0);
    let timeoutTimer;
    let settled = false;

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      job.state = "settled";
      clearTimeout(timeoutTimer);
      clearTimeout(job.cancelTimer);
      clearTimeout(job.killTimer);
      if (activeProbes.get(mediaUrl) === job) activeProbes.delete(mediaUrl);

      if (job.abortReason === "client-disconnect") {
        console.info("[ffprobe] Probe cancelled after all requesting clients disconnected.");
        reject(Object.assign(new Error("Probe cancelled by client disconnect"), { code: "ABORT_ERR" }));
        return;
      }
      if (job.abortReason === "timeout") {
        const error = new Error(`ffprobe exceeded the ${FFPROBE_TIMEOUT_MS}ms timeout`);
        error.code = "ETIMEDOUT";
        console.error("[ffprobe] Probe timed out:", error.message);
        reject(error);
        return;
      }
      if (job.streamError || job.processError || job.outputError) {
        const error = job.outputError || job.streamError || job.processError;
        console.error("[ffprobe] Probe process failed:", error);
        reject(error);
        return;
      }
      if (code !== 0) {
        const details = stderr.toString("utf8").trim();
        const error = new Error(
          `ffprobe exited with code ${code}${signal ? ` (${signal})` : ""}` +
            (details ? `: ${details}` : "")
        );
        error.code = /\b(?:HTTP error|Server returned)\s*429\b/i.test(details)
          ? "ERATELIMIT"
          : "EFFPROBE";
        console.error("[ffprobe] Probe process failed:", error);
        reject(error);
        return;
      }

      try {
        const output = Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8");
        const data = buildProbeData(JSON.parse(output), mediaUrl);
        cacheProbe(mediaUrl, data);
        resolve(data);
      } catch (err) {
        console.error("[ffprobe] Failed to parse stream metadata:", err);
        reject(Object.assign(new Error("Failed to parse stream metadata"), { code: "EPROBEOUTPUT" }));
      }
    };

    const args = [
      ...FFMPEG_HTTP_ARGS,
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      mediaUrl,
    ];

    try {
      console.info("[ffprobe] Starting metadata probe.");
      const child = spawn("ffprobe", args, {
        signal: job.controller.signal,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      job.child = child;

      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_PROBE_STDOUT_BYTES) {
          job.outputError = new Error(
            `ffprobe output exceeded ${MAX_PROBE_STDOUT_BYTES} bytes`
          );
          terminateProbe(job, "output-limit");
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stdout.on("error", (err) => {
        job.streamError = err;
        terminateProbe(job, "stream-error");
      });
      child.stderr.on("data", (chunk) => {
        stderr = Buffer.concat([stderr, chunk]).subarray(-16384);
      });
      child.stderr.on("error", (err) => {
        job.streamError = err;
        terminateProbe(job, "stream-error");
      });
      child.once("error", (err) => {
        job.processError = err;
      });
      child.once("exit", (exitCode, signal) => {
        job.exitCode = exitCode;
        job.exitSignal = signal;
      });
      child.once("close", finish);

      if (FFPROBE_TIMEOUT_MS > 0) {
        timeoutTimer = setTimeout(() => {
          if (job.child?.exitCode === null && job.child?.signalCode === null) {
            terminateProbe(job, "timeout");
          }
        }, FFPROBE_TIMEOUT_MS);
        timeoutTimer.unref?.();
      }
    } catch (err) {
      job.processError = err;
      finish(null, null);
    }
  });

  return job;
}

// Clean up stale HLS sessions older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  let entries;
  try {
    entries = fs.readdirSync(HLS_ROOT);
  } catch (err) {
    console.error("[HLS cleanup] Unable to list temporary files:", err);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(HLS_ROOT, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff && !activeJobs.has(entry)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`[HLS cleanup] Unable to remove ${fullPath}:`, err);
      }
    }
  }
}, 30 * 60 * 1000);

// ─── 1. Magnet Link Stream Endpoint (HTTP Range Streaming) ───────────────────
function getOrAddTorrent(magnetUri) {
  const existing = activeTorrents.get(magnetUri);
  if (existing?.ready) return Promise.resolve(existing);

  const pending = activeTorrentLoads.get(magnetUri);
  if (pending) return pending;

  let timer;
  let settled = false;
  const load = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    timer = setTimeout(() => fail(new Error("Torrent metadata timeout")), 35000);

    try {
      wtClient.add(magnetUri, { path: path.join(HLS_ROOT, "torrents") }, (torrent) => {
        clearTimeout(timer);
        torrent.on("error", (err) => {
          console.error("[magnet] Torrent error:", err);
          activeTorrents.delete(magnetUri);
        });

        const videoExts = /\.(mp4|mkv|webm|avi|mov|m4v|ts)$/i;
        const files = Array.isArray(torrent.files) ? torrent.files : [];
        const videoFiles = files.filter((file) => videoExts.test(file.name));
        const targetFile = (videoFiles.length ? videoFiles : files).sort(
          (a, b) => b.length - a.length
        )[0];

        if (!targetFile) {
          fail(new Error("No playable video file found in magnet"));
          return;
        }

        const entry = { torrent, file: targetFile, ready: true };
        activeTorrents.set(magnetUri, entry);
        if (!settled) {
          settled = true;
          resolve(entry);
        }
      });
    } catch (err) {
      fail(err);
    }
  });

  activeTorrentLoads.set(magnetUri, load);
  load.then(
    () => {
      if (activeTorrentLoads.get(magnetUri) === load) activeTorrentLoads.delete(magnetUri);
    },
    () => {
      if (activeTorrentLoads.get(magnetUri) === load) activeTorrentLoads.delete(magnetUri);
    }
  );
  return load;
}

wtClient.on("error", (err) => {
  console.error("[magnet] WebTorrent client error:", err);
});

app.get("/api/magnet/info", async (req, res) => {
  const magnet = req.query.magnet;
  if (!magnet) return res.status(400).json({ error: "Missing magnet" });
  const client = monitorClient(req, res);
  if (client.disconnected) {
    client.dispose();
    return;
  }
  try {
    const { file } = await getOrAddTorrent(magnet);
    if (client.disconnected) return;
    const streamUrl = `${req.protocol}://${req.get("host")}/api/magnet/stream?magnet=${encodeURIComponent(magnet)}`;
    res.json({
      fileName: file.name,
      size: file.length,
      streamUrl,
    });
  } catch (err) {
    console.error("[magnet info] Request failed:", err);
    if (!client.disconnected && !res.headersSent && !res.destroyed) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    client.dispose();
  }
});

app.get("/api/magnet/stream", async (req, res) => {
  const magnet = req.query.magnet;
  if (!magnet) return res.status(400).end();
  let source;
  const client = monitorClient(req, res, () => {
    if (source && !source.destroyed) source.destroy();
  });
  if (client.disconnected) {
    client.dispose();
    return;
  }

  try {
    const { file } = await getOrAddTorrent(magnet);
    if (client.disconnected) return;

    const total = file.length;
    const range = parseByteRange(req.headers.range, total);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", getVideoContentType(file.name));

    if (range.type === "unsatisfiable") {
      res.status(416);
      res.setHeader("Content-Range", `bytes */${total}`);
      res.setHeader("Content-Length", "0");
      return res.end();
    }

    if (range.type === "range") {
      const contentLength = range.end - range.start + 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
      res.setHeader("Content-Length", String(contentLength));
      source = file.createReadStream({ start: range.start, end: range.end });
    } else {
      res.status(200);
      res.setHeader("Content-Length", String(total));
      source = file.createReadStream();
    }

    await pipeline(source, res);
  } catch (err) {
    logStreamError("magnet stream", err, client.disconnected);
    if (!client.disconnected) sendStreamFailure(res, 502, "Unable to stream the requested media");
  } finally {
    client.dispose();
  }
});

// ─── 2. Probe Video Duration, Resolution, Audio & Subtitle Tracks ────────────
app.get("/api/probe", async (req, res) => {
  const mediaUrl = req.query.url;
  if (!mediaUrl) return res.status(400).json({ error: "Missing url" });

  let job = null;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseProbe(job);
  };
  const client = monitorClient(req, res, release);

  try {
    if (client.disconnected) return;

    const cached = getCachedProbe(mediaUrl);
    if (cached) {
      res.json(cached);
      return;
    }

    job = getOrStartProbe(mediaUrl);
    subscribeToProbe(job);

    const probeData = await job.promise;
    if (!client.disconnected && !res.destroyed) res.json(probeData);
  } catch (err) {
    if (client.disconnected) return;
    const status = err.code === "ETIMEDOUT" ? 504 : err.code === "ERATELIMIT" ? 429 : 500;
    if (!res.headersSent && !res.destroyed) {
      res.status(status).json({
        error: err.code === "ETIMEDOUT"
          ? "ffprobe timed out"
          : err.code === "ERATELIMIT"
            ? "Media host rate-limited the metadata probe"
            : "ffprobe failed",
        details: err.message,
      });
    }
  } finally {
    release();
    client.dispose();
  }
});

// ─── 3. Extract Embedded MKV Subtitle Stream as WebVTT (.vtt) ────────────────
app.get("/api/subtitle.vtt", async (req, res) => {
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

  let source;
  let ff;
  const client = monitorClient(req, res, () => {
    if (source && !source.destroyed) source.destroy();
    if (ff && ff.exitCode === null) ff.kill("SIGKILL");
  });
  if (client.disconnected) {
    client.dispose();
    return;
  }

  try {
    if (fs.existsSync(cachedVtt) && fs.statSync(cachedVtt).size > 20) {
      source = fs.createReadStream(cachedVtt);
      await pipeline(source, res);
      return;
    }

    ff = spawn("ffmpeg", [
      ...FFMPEG_HTTP_ARGS,
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-i", mediaUrl,
      "-map", streamMap,
      "-f", "webvtt",
      "pipe:1",
    ]);

    const chunks = [];
    let stderr = Buffer.alloc(0);
    ff.stdout.on("data", (chunk) => chunks.push(chunk));
    ff.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, chunk]).subarray(-8192);
    });
    ff.stderr.on("error", (err) => {
      logStreamError("subtitle ffmpeg stderr", err, client.disconnected);
    });

    const processResult = new Promise((resolve) => {
      let completed = false;
      ff.once("error", (error) => {
        if (completed) return;
        completed = true;
        resolve({ error });
      });
      ff.once("close", (code, signal) => {
        if (completed) return;
        completed = true;
        resolve({ code, signal });
      });
    });

    source = ff.stdout;
    const [streamResult, result] = await Promise.all([
      pipeline(source, res).then(
        () => ({ error: null }),
        (error) => ({ error })
      ),
      processResult,
    ]);
    if (result.error) {
      logStreamError("subtitle ffmpeg", result.error, client.disconnected);
      if (!client.disconnected) sendStreamFailure(res, 502, "Subtitle extraction failed");
      return;
    }

    if (streamResult.error) {
      logStreamError("subtitle stream", streamResult.error, client.disconnected);
      if (!client.disconnected) sendStreamFailure(res, 502, "Unable to stream subtitles");
      return;
    }

    if (client.disconnected && result.signal === "SIGKILL") return;

    if (result.code !== 0) {
      const details = stderr.toString("utf8").trim();
      const error = new Error(
        `ffmpeg exited with code ${result.code}${result.signal ? ` (${result.signal})` : ""}` +
          (details ? `: ${details}` : "")
      );
      logStreamError("subtitle ffmpeg", error, client.disconnected);
      return;
    }

    const full = Buffer.concat(chunks);
    if (full.length > 20) {
      fs.writeFile(cachedVtt, full, (err) => {
        if (err) console.error("[subtitle cache] Unable to save extracted subtitles:", err);
      });
    }
  } catch (err) {
    logStreamError("subtitle stream", err, client.disconnected);
    if (!client.disconnected) sendStreamFailure(res, 502, "Unable to stream subtitles");
  } finally {
    client.dispose();
  }
});

// ─── 4. Live-Remux Video + Selected Audio Track (fMP4 for 4K HEVC & iOS) ─────
app.get("/api/hls/master.m3u8", async (req, res) => {
  const mediaUrl = req.query.url;
  const audioIdx = Number(req.query.audio || 0);
  const startSec = Math.max(0, Math.floor(Number(req.query.start || 0)));
  if (!mediaUrl) return res.status(400).send("Missing url");

  const client = monitorClient(req, res);
  if (client.disconnected) {
    client.dispose();
    return;
  }

  const hash = crypto
    .createHash("md5")
    .update(`${mediaUrl}-a${audioIdx}-s${startSec}-fmp4`)
    .digest("hex");
  const outDir = path.join(HLS_ROOT, hash);
  const playlistPath = path.join(outDir, "index.m3u8");

  const cachedProbe = getCachedProbe(mediaUrl);
  const isHevc =
    cachedProbe?.videoCodec === "hevc" ||
    /\b(hevc|h265|x265)\b/i.test(mediaUrl);

  try {
    if (!activeJobs.has(hash) && !fs.existsSync(playlistPath)) {
      fs.mkdirSync(outDir, { recursive: true });

      const args = [
        ...FFMPEG_HTTP_ARGS,
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        ...(startSec > 0 ? ["-ss", String(startSec)] : []),
        "-i", mediaUrl,
        "-map", "0:v:0",
        "-map", `0:a:${audioIdx}?`,
        "-c:v", "copy",
        ...(isHevc ? ["-tag:v", "hvc1"] : []),
        "-c:a", "aac",
        "-ac", "2",
        "-b:a", "192k",
        ...(startSec > 0 ? ["-output_ts_offset", String(startSec)] : []),
        "-f", "hls",
        "-hls_time", "4",
        "-hls_list_size", "0",
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", path.join(outDir, "seg_%05d.m4s"),
        playlistPath,
      ];

      const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = Buffer.alloc(0);
      let spawnFailed = false;
      activeJobs.set(hash, proc);
      proc.stderr.on("data", (chunk) => {
        stderr = Buffer.concat([stderr, chunk]).subarray(-8192);
      });
      proc.stderr.on("error", (err) => logStreamError("HLS ffmpeg stderr", err, false));
      proc.once("error", (err) => {
        spawnFailed = true;
        console.error("[HLS ffmpeg] Unable to start remux:", err);
        if (activeJobs.get(hash) === proc) activeJobs.delete(hash);
      });
      proc.once("close", (code, signal) => {
        if (activeJobs.get(hash) === proc) activeJobs.delete(hash);
        if (!spawnFailed && code !== 0 && !proc.killed) {
          const details = stderr.toString("utf8").trim();
          console.error(
            `[HLS ffmpeg] Remux exited with code ${code}${signal ? ` (${signal})` : ""}` +
              (details ? `: ${details}` : "")
          );
        }
      });
    }

    const waitStart = Date.now();
    while (
      !client.disconnected &&
      !fs.existsSync(playlistPath) &&
      activeJobs.has(hash) &&
      Date.now() - waitStart < 45000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (client.disconnected) return;
    if (!fs.existsSync(playlistPath)) {
      if (activeJobs.has(hash)) {
        return res.status(504).send("Stream initialization timed out");
      }
      return res.status(502).send("The media remux process exited before creating a playlist");
    }

    res.redirect(`/api/hls-files/${hash}/index.m3u8`);
  } catch (err) {
    console.error("[HLS master] Stream initialization failed:", err);
    if (!client.disconnected) sendStreamFailure(res, 502, "Unable to initialize the media stream");
  } finally {
    client.dispose();
  }
});

app.use(
  "/api/hls-files",
  express.static(HLS_ROOT, {
    setHeaders: (res, filePath) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (filePath.endsWith(".m3u8")) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      } else if (filePath.endsWith(".m4s") || filePath.endsWith(".mp4")) {
        res.setHeader("Content-Type", "video/mp4");
      }
    },
  })
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Media Proxy running on http://0.0.0.0:${PORT}`);
  console.log(
    `FFprobe timeout: ${FFPROBE_TIMEOUT_MS === 0 ? "disabled" : `${FFPROBE_TIMEOUT_MS}ms`}`
  );
});