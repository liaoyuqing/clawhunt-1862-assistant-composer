#!/usr/bin/env node
/**
 * Mock assistant SSE service for the chat composer demo.
 *
 * Modes (POST body field "mode" wins over the --mode flag):
 *   normal    stream every event type once and finish
 *   drop      send message_start + 2 deltas, then kill the socket (simulates a mid-stream drop)
 *   drop-once drop the first request of a session, stream normally afterwards (retry succeeds)
 *   disabled  503 with {"code":"ASSISTANT_DISABLED"}
 *   ratelimit 503 with {"code":"RATE_LIMITED"}
 *   slow      stream a delta every 400 ms so the stop button has time to act
 *
 * Usage: node mock-server/sse.mjs [--port 8787] [--mode normal]
 */
import http from "node:http";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1] ?? fallback;
};

const PORT = Number(flag("port", process.env.MOCK_PORT ?? 8787));
let defaultMode = flag("mode", process.env.MOCK_MODE ?? "normal");
const droppedSessions = new Set();

const SAMPLE_TEXT =
  "星澜科技为本季度的资源对接会预留了 3 个专场名额，" +
  "会员可以在工作台的商机看板里提交对接申请；" +
  "云栖生物与恒泰智造两家会员已经通过审核。";

function sseFrame(event, payload, id) {
  const head = id ? `id: ${id}\n` : "";
  return `${head}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function writeChunk(res, text) {
  res.write(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function streamNormal(req, res, mode) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const messageId = `msg_${Date.now().toString(36)}`;
  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  writeChunk(res, ": ping\n\n");
  writeChunk(res, sseFrame("message_start", { message_id: messageId, role: "assistant" }, messageId));

  if (mode === "drop" || (mode === "drop-once" && !droppedSessions.has(messageId))) {
    writeChunk(res, sseFrame("delta", { text: "星澜科技为本季度的资源对接会" }));
    writeChunk(res, sseFrame("delta", { text: "预留了 3 个专场名额，" }));
    if (mode === "drop-once") droppedSessions.add(messageId);
    setTimeout(() => {
      // Destroying the response (not just the request socket) makes the SSE body
      // end mid-flight for the browser even when a dev proxy sits in between.
      res.destroy();
      req.socket.destroy();
    }, 120);
    return;
  }

  const parts = [
    "星澜科技为本季度的资源对接会",
    "预留了 3 个专场名额，",
    "会员可以在工作台的商机看板里提交对接申请；",
    "云栖生物与恒泰智造两家会员已经通过审核。",
  ];
  const gap = mode === "slow" ? 400 : 60;
  let step = 0;

  const tick = () => {
    if (closed) return;
    if (step < parts.length) {
      writeChunk(res, sseFrame("delta", { text: parts[step] }));
      step += 1;
      setTimeout(tick, gap);
      return;
    }
    writeChunk(
      res,
      sseFrame("tool_call", {
        tool_call_id: "tool_1",
        name: "search_member_spaces",
        arguments: { keyword: "资源对接会", org_id: "demo-org" },
      }),
    );
    writeChunk(
      res,
      sseFrame("tool_confirmation_required", {
        tool_call_id: "tool_1",
        name: "search_member_spaces",
        prompt: "将读取会员空间的可公开资源目录，是否继续？",
      }),
    );
    writeChunk(
      res,
      sseFrame("tool_result", { tool_call_id: "tool_1", ok: true, summary: "匹配到 3 个专场" }),
    );
    writeChunk(
      res,
      sseFrame("citation", { index: 1, title: "会员空间平台 · 资源对接手册（虚构）", url: "https://example.com/member-spaces/handbook" }),
    );
    writeChunk(res, sseFrame("message_end", { message_id: messageId, finish_reason: "stop" }, messageId));
    res.end();
  };

  setTimeout(tick, gap);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/api/health") {
    json(res, 200, { ok: true, mode: defaultMode });
    return;
  }

  // Lets a demo or a screenshot run switch the fault mode without restarting the process.
  if (url.pathname === "/api/mock/mode" && req.method === "POST") {
    const body = await readBody(req);
    if (typeof body.mode === "string" && body.mode.length > 0) defaultMode = body.mode;
    console.log(`[mock] default mode is now ${defaultMode}`);
    json(res, 200, { ok: true, mode: defaultMode });
    return;
  }

  if (url.pathname === "/api/assistant/cancel" && req.method === "POST") {
    const body = await readBody(req);
    console.log(`[mock] cancel session=${body.session_id ?? "-"}`);
    json(res, 200, { ok: true, cancelled: true });
    return;
  }

  if (url.pathname === "/api/assistant/chat" && req.method === "POST") {
    const body = await readBody(req);
    const mode = body.mode ?? defaultMode;
    console.log(`[mock] chat session=${body.session_id ?? "-"} mode=${mode} question=${JSON.stringify(body.question ?? "").slice(0, 60)}`);
    if (mode === "disabled") {
      json(res, 503, { code: "ASSISTANT_DISABLED", message: "助手已暂停使用" });
      return;
    }
    if (mode === "ratelimit") {
      json(res, 503, { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" });
      return;
    }
    streamNormal(req, res, mode);
    return;
  }

  json(res, 404, { code: "NOT_FOUND", message: `no route for ${req.method} ${url.pathname}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] SSE service on http://127.0.0.1:${PORT} (mode=${defaultMode})`);
  console.log("[mock] POST /api/assistant/chat  {session_id, question, mode?}");
  console.log("[mock] POST /api/assistant/cancel");
  console.log("[mock] POST /api/mock/mode  {mode}  switch the default fault mode");
  console.log("[mock] GET  /api/health");
});

