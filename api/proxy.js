const NVIDIA_NIM_BASE = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const { url } = req;

  if (url === "/" || url === "/health") {
    return res.status(200).json({ status: "ok", proxy: "NVIDIA NIM", version: "1.1" });
  }

  if (url === "/v1/models") {
    return res.status(200).json({
      object: "list",
      data: [
        "meta/llama-3.1-70b-instruct",
        "meta/llama-3.1-405b-instruct",
        "meta/llama-3.3-70b-instruct",
        "mistralai/mixtral-8x22b-instruct-v0.1",
        "mistralai/mistral-large-2-instruct",
        "microsoft/phi-3-medium-128k-instruct",
        "nvidia/llama-3.1-nemotron-70b-instruct",
        "z-ai/glm4.7",
        "z-ai/glm5",
        "deepseek-ai/deepseek-v3.2",
      ].map((id) => ({ id, object: "model", created: 1700000000, owned_by: "nvidia" })),
    });
  }

  if (url !== "/v1/chat/completions") {
    return res.status(404).json({ error: "Not found" });
  }

  // On Vercel, environment variables are accessed via process.env
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  if (!nvidiaKey) {
    return res.status(500).json({
      error: { message: "NVIDIA_API_KEY is not set in Vercel environment variables.", type: "proxy_error", code: 500 },
    });
  }

  const body = req.body;
  if (!body) {
    return res.status(400).json({ error: { message: "Missing request body.", type: "proxy_error", code: 400 } });
  }

  const nimRequest = {
    model: body.model || DEFAULT_MODEL,
    messages: body.messages || [],
    temperature: body.temperature ?? 0.7,
    top_p: body.top_p ?? 0.95,
    max_tokens: body.max_tokens || 1024,
    stream: body.stream ?? false,
  };

  if (body.frequency_penalty !== undefined) nimRequest.frequency_penalty = body.frequency_penalty;
  if (body.presence_penalty !== undefined) nimRequest.presence_penalty = body.presence_penalty;
  if (body.stop !== undefined) nimRequest.stop = body.stop;

  try {
    const nimResponse = await fetch(`${NVIDIA_NIM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nvidiaKey}`,
      },
      body: JSON.stringify(nimRequest),
    });

    if (body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      const reader = nimResponse.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      return res.end();
    }

    const data = await nimResponse.json();
    return res.status(nimResponse.status).json(data);

  } catch (err) {
    return res.status(502).json({
      error: { message: `Proxy error: ${err.message}`, type: "proxy_error", code: 502 },
    });
  }
}
