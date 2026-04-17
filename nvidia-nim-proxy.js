/**
 * NVIDIA NIM OpenAI-Compatible Proxy
 * Deploy on Cloudflare Workers (free tier)
 *
 * This worker accepts OpenAI-format requests and forwards them
 * to the NVIDIA NIM API, translating as needed.
 *
 * HOW TO USE:
 *  1. Create a Cloudflare Worker at dash.cloudflare.com
 *  2. Paste this code into the worker editor
 *  3. Add your NVIDIA API key as a secret:
 *       wrangler secret put NVIDIA_API_KEY
 *     OR in the dashboard: Settings → Variables → Add secret "NVIDIA_API_KEY"
 *  4. Deploy and copy your worker URL (e.g. https://nim-proxy.yourname.workers.dev)
 *  5. In JanitorAI: set API URL to your worker URL, API key to anything (e.g. "nim")
 */

const NVIDIA_NIM_BASE = "https://integrate.api.nvidia.com/v1";

// Default model — change to any model available on build.nvidia.com
// Some popular options:
//   meta/llama-3.1-70b-instruct
//   meta/llama-3.1-405b-instruct
//   mistralai/mixtral-8x22b-instruct-v0.1
//   microsoft/phi-3-medium-128k-instruct
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";

export default {
  async fetch(request, env) {
    // Handle CORS preflight (required for browser-based clients like JanitorAI)
    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", proxy: "NVIDIA NIM", version: "1.0" }),
        { headers: jsonHeaders() }
      );
    }

    // Model list endpoint — JanitorAI may call this to populate the model dropdown
    if (url.pathname === "/v1/models") {
      return modelsResponse();
    }

    // Main chat completions endpoint
    if (url.pathname === "/v1/chat/completions") {
      return handleChatCompletions(request, env);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: jsonHeaders(),
    });
  },
};

async function handleChatCompletions(request, env) {
  // Validate NVIDIA API key is configured
  const nvidiaKey = env.NVIDIA_API_KEY;
  if (!nvidiaKey) {
    return errorResponse(500, "NVIDIA_API_KEY secret is not configured in this Worker.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body.");
  }

  // Use the requested model, or fall back to the default
  const model = body.model || DEFAULT_MODEL;

  // Build the NIM request — NIM uses the same format as OpenAI,
  // so we mostly just need to forward it with the right auth header.
  const nimRequest = {
    model,
    messages: body.messages || [],
    temperature: body.temperature ?? 0.7,
    top_p: body.top_p ?? 0.95,
    max_tokens: body.max_tokens || 1024,
    stream: body.stream ?? false,
  };

  // Optional parameters forwarded if present
  if (body.frequency_penalty !== undefined) nimRequest.frequency_penalty = body.frequency_penalty;
  if (body.presence_penalty !== undefined) nimRequest.presence_penalty = body.presence_penalty;
  if (body.stop !== undefined) nimRequest.stop = body.stop;

  try {
    const nimResponse = await fetch(`${NVIDIA_NIM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${nvidiaKey}`,
      },
      body: JSON.stringify(nimRequest),
    });

    // For streaming responses, pipe directly back to the client
    if (body.stream) {
      return new Response(nimResponse.body, {
        status: nimResponse.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          ...corsHeaders(),
        },
      });
    }

    // For non-streaming, read and forward the JSON response
    const data = await nimResponse.json();

    // If NIM returned an error, forward it cleanly
    if (!nimResponse.ok) {
      return new Response(JSON.stringify(data), {
        status: nimResponse.status,
        headers: jsonHeaders(),
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: jsonHeaders(),
    });

  } catch (err) {
    return errorResponse(502, `Proxy error: ${err.message}`);
  }
}

function modelsResponse() {
  const models = [
    "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-405b-instruct",
    "meta/llama-3.3-70b-instruct",
    "mistralai/mixtral-8x22b-instruct-v0.1",
    "mistralai/mistral-large-2-instruct",
    "microsoft/phi-3-medium-128k-instruct",
    "google/gemma-2-27b-it",
    "nvidia/llama-3.1-nemotron-70b-instruct",
  ];

  return new Response(
    JSON.stringify({
      object: "list",
      data: models.map((id) => ({
        id,
        object: "model",
        created: 1700000000,
        owned_by: "nvidia",
      })),
    }),
    { headers: jsonHeaders() }
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    ...corsHeaders(),
  };
}

function corsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function errorResponse(status, message) {
  return new Response(
    JSON.stringify({ error: { message, type: "proxy_error", code: status } }),
    { status, headers: jsonHeaders() }
  );
}
