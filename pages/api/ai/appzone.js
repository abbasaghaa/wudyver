import axios from "axios";
import FormData from "form-data";
class AIGen {
  constructor(key = "az-chatai-key", base = "https://api.appzone.tech") {
    this.key = key;
    this.base = base;
    this.ax = axios.create({
      baseURL: base,
      headers: {
        Authorization: `Bearer ${key}`
      },
      timeout: 12e4
    });
  }
  async _handleMedia(media) {
    if (Buffer.isBuffer(media)) {
      console.log("[Gen] Media is a buffer.");
      return media;
    }
    if (typeof media === "string") {
      if (media.startsWith("http://") || media.startsWith("https://")) {
        console.log(`[Gen] Fetching media from URL: ${media}`);
        const response = await axios.get(media, {
          responseType: "arraybuffer"
        });
        return Buffer.from(response.data);
      }
      console.log("[Gen] Media is a base64 string.");
      return Buffer.from(media, "base64");
    }
    throw new Error("Invalid media type. Please provide a URL, base64 string, or a Buffer.");
  }
  async generate({
    mode,
    prompt,
    messages,
    media,
    ...rest
  }) {
    const m = mode || "chat";
    console.log(`[Gen] Mode: ${m}`);
    try {
      if (m === "chat") return await this.chat(messages?.length ? messages : prompt, rest);
      if (m === "image") return await this.img(prompt, rest);
      if (m === "transcribe") return await this.trans(media, rest);
      if (m === "extract") return await this.ext(media, rest);
      throw new Error("Invalid mode");
    } catch (e) {
      console.error(`[Gen] Error:`, e?.message || e);
      throw e;
    }
  }
  async chat(input, {
    stream = true,
    model = "gpt-4",
    userId,
    ...opts
  } = {}) {
    console.log(`[Chat] Start - Stream: ${stream}`);
    try {
      const msgs = Array.isArray(input) ? input : [{
        role: "user",
        content: input
      }];
      const payload = {
        model: model,
        stream: stream,
        messages: msgs,
        ...opts
      };
      const res = await this.ax.post("/v1/chat/completions", payload, {
        headers: {
          "Content-Type": "application/json",
          ...userId ? {
            "X-User-ID": userId
          } : {}
        },
        responseType: stream ? "stream" : "json"
      });
      if (stream) {
        console.log(`[Chat] Streaming response`);
        return this.handleStream(res.data);
      }
      console.log(res.data);
      return res.data;
    } catch (e) {
      console.error(`[Chat] Failed:`, e?.response?.data || e?.message);
      throw e;
    }
  }
  async img(prompt, {
    size = "1024x1024",
    n = 1,
    ...opts
  } = {}) {
    console.log(`[Img] Generate: ${size}`);
    try {
      const res = await this.ax.post("/v1/images/generations", {
        prompt: prompt,
        size: size,
        n: n,
        ...opts
      }, {
        headers: {
          "Content-Type": "application/json"
        }
      });
      console.log(res.data);
      return res.data;
    } catch (e) {
      console.error(`[Img] Failed:`, e?.response?.data || e?.message);
      throw e;
    }
  }
  async trans(media, {
    lang = "en",
    filename = "audio.wav",
    contentType = "audio/wav",
    ...opts
  } = {}) {
    console.log(`[Trans] File: ${filename}`);
    try {
      const buffer = await this._handleMedia(media);
      const form = new FormData();
      form.append("file", buffer, {
        filename: filename,
        contentType: contentType
      });
      if (lang) form.append("language", lang);
      const res = await this.ax.post("/transcribe-audio", form, {
        headers: {
          ...form.getHeaders(),
          Accept: "application/json"
        },
        ...opts
      });
      console.log(res.data);
      return res.data;
    } catch (e) {
      console.error(`[Trans] Failed:`, e?.response?.data || e?.message);
      throw e;
    }
  }
  async ext(media, {
    filename = "document.pdf",
    contentType = "application/pdf",
    ...opts
  } = {}) {
    console.log(`[Ext] Processing: ${filename}`);
    try {
      const buffer = await this._handleMedia(media);
      const form = new FormData();
      form.append("file", buffer, {
        filename: filename,
        contentType: contentType
      });
      const res = await this.ax.post("/extract-text", form, {
        headers: {
          ...form.getHeaders()
        },
        timeout: 6e4,
        ...opts
      });
      console.log(res.data);
      return res.data;
    } catch (e) {
      console.error(`[Ext] Failed:`, e?.response?.data || e?.message);
      throw e;
    }
  }
  handleStream(stream) {
    return new Promise((resolve, reject) => {
      const resolvedData = {
        result: "",
        model: "",
        id: "",
        chunk: []
      };
      stream.on("data", chunk => {
        const lines = chunk.toString().split("\n").filter(l => l.trim());
        for (const line of lines) {
          if (line === "data: [DONE]") continue;
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            resolvedData.chunk.push(data);
            if (!resolvedData.id && data.id) {
              resolvedData.id = data.id;
            }
            if (!resolvedData.model && data.model) {
              resolvedData.model = data.model;
            }
            const content = data?.choices?.[0]?.delta?.content;
            if (content) {
              resolvedData.result += content;
            }
          } catch (e) {
            console.warn(`[Stream] Parse error:`, e?.message);
          }
        }
      });
      stream.on("end", () => {
        console.log(`\n[Stream] Complete - Total: ${resolvedData.result.length} chars`);
        resolve(resolvedData);
      });
      stream.on("error", reject);
    });
  }
}
export default async function handler(req, res) {
  const params = req.method === "GET" ? req.query : req.body;
  if (!params.prompt) {
    return res.status(400).json({
      error: "Prompt are required"
    });
  }
  try {
    const client = new AIGen();
    const response = await client.generate(params);
    return res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Internal Server Error"
    });
  }
}