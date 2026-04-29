const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());

app.get("/proxy-video", async (req, res) => {
  try {
    const videoUrl = req.query.url;

    if (!videoUrl) {
      return res.status(400).send("Missing video URL");
    }

    const range = req.headers.range;

    const headers = {
      Referer: "https://cdn.juicybits.site/",
      Origin: "https://cdn.juicybits.site",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    };

    if (range) {
      headers.Range = range;
    }

    const response = await axios({
      method: "GET",
      url: videoUrl,
      responseType: "stream",
      headers,
      validateStatus: () => true,
    });

    res.status(response.status);

    // Pass useful headers through
    if (response.headers["content-type"]) {
      res.setHeader(
        "Content-Type",
        response.headers["content-type"]
      );
    }

    if (response.headers["content-length"]) {
      res.setHeader(
        "Content-Length",
        response.headers["content-length"]
      );
    }

    if (response.headers["content-range"]) {
      res.setHeader(
        "Content-Range",
        response.headers["content-range"]
      );
    }

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    response.data.pipe(res);
  } catch (error) {
    console.error("Proxy Error:", error.message);
    res.status(500).send("Proxy failed");
  }
});

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
});