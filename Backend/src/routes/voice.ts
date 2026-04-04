import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { z } from "zod";
import { getCurrentUser } from "../middleware/auth";
import {
  GEMINI_CLIENT_FRIENDLY_MESSAGE,
  isLikelyGeminiRelatedError,
  translateEnglishToHindiForSpeech,
  voiceStoryAnswer,
} from "../lib/gemini";

export const voiceRouter = new Hono();

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";

/** ConvAI token must be requested from the same region as WebRTC LiveKit (fixes LiveKit "v1 RTC path not found" / 404). */
type ElevenLocation = "us" | "global" | "eu-residency" | "in-residency";

function normalizeElevenLocation(raw: string | undefined): ElevenLocation {
  const s = (raw || "us").trim().toLowerCase().replace(/_/g, "-");
  if (s === "eu" || s === "eu-residency") return "eu-residency";
  if (s === "in" || s === "in-residency") return "in-residency";
  if (s === "global") return "global";
  if (s === "us" || s === "") return "us";
  return "us";
}

function convaiApiV1Base(location: ElevenLocation): string {
  const map: Record<ElevenLocation, string> = {
    us: "https://api.elevenlabs.io/v1",
    global: "https://api.elevenlabs.io/v1",
    "eu-residency": "https://api.eu.residency.elevenlabs.io/v1",
    "in-residency": "https://api.in.residency.elevenlabs.io/v1",
  };
  return map[location];
}

function parseElevenLabsTtsError(errText: string): { message?: string; code?: string } {
  try {
    const j = JSON.parse(errText) as {
      detail?: { message?: string; code?: string } | string;
    };
    if (j.detail == null) return {};
    if (typeof j.detail === "string") return { message: j.detail };
    return { message: j.detail.message, code: j.detail.code };
  } catch {
    return {};
  }
}

/**
 * GET /api/voice/status
 * Which ElevenLabs features are configured (never exposes API key).
 */
voiceRouter.get("/voice/status", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);

  const apiKey = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  const voiceId = Boolean(process.env.ELEVENLABS_VOICE_ID?.trim());
  const voiceIdHi = Boolean(process.env.ELEVENLABS_VOICE_ID_HI?.trim());
  const gemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const agentId = Boolean(process.env.ELEVENLABS_AGENT_ID?.trim());
  const serverLocation = normalizeElevenLocation(process.env.ELEVENLABS_SERVER_LOCATION);

  return c.json({
    ttsReady: apiKey && voiceId,
    /** Hindi listen: second premade voice + Gemini translates the brief to Devanagari Hindi */
    ttsHindiReady: apiKey && voiceIdHi && gemini,
    agentReady: apiKey && agentId,
    voiceChatGeminiReady: apiKey && agentId && gemini,
    /** Browser mic Q&A: Gemini + TTS only (no ElevenLabs agent / client tools required) */
    browserVoiceQaReady: apiKey && voiceId && gemini,
    elevenlabsServerLocation: serverLocation,
    /** Model hint for docs only */
    ttsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_turbo_v2_5",
    /** Which env vars are non-empty (never exposes values) — for debugging setup */
    envPresent: {
      apiKey,
      voiceId,
      voiceIdHi,
      geminiForHindi: gemini,
      geminiApi: gemini,
      agentId,
    },
  });
});

const geminiVoiceReplySchema = z.object({
  user_question: z.string().min(1).max(2000),
  context_text: z.string().min(1).max(14000),
});

/**
 * POST /api/voice/gemini-voice-reply
 * Gemini answer for ElevenLabs client tool (spoken Q&A grounded in narrative context).
 */
voiceRouter.post("/voice/gemini-voice-reply", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    if (!process.env.GEMINI_API_KEY?.trim()) {
      return c.json(
        { error: "Gemini not configured", hint: "Set GEMINI_API_KEY in Backend .env for voice Q&A." },
        503
      );
    }

    const body = await c.req.json();
    const { user_question, context_text } = geminiVoiceReplySchema.parse(body);
    const answer = await voiceStoryAnswer(context_text, user_question);
    return c.json({ answer });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return c.json({ error: "Invalid body", details: e.errors }, 400);
    }
    console.error("voice gemini-voice-reply:", e);
    const raw = e instanceof Error ? e.message : String(e);
    const message = isLikelyGeminiRelatedError(raw)
      ? GEMINI_CLIENT_FRIENDLY_MESSAGE
      : process.env.NODE_ENV === "development"
        ? raw.slice(0, 300)
        : GEMINI_CLIENT_FRIENDLY_MESSAGE;
    return c.json({ error: "Could not generate answer", message }, 502);
  }
});

const ttsBodySchema = z.object({
  text: z.string().min(1).max(5000),
  locale: z.enum(["en", "hi"]).optional().default("en"),
  /** When locale is hi and text is already Devanagari (e.g. Gemini voice reply), skip EN→HI translation */
  skip_translate: z.boolean().optional().default(false),
});

/**
 * POST /api/voice/tts
 * Proxies text-to-speech; returns JSON { displayText, mimeType, audioBase64 } for synced UI.
 */
voiceRouter.post("/voice/tts", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const voiceIdEn = process.env.ELEVENLABS_VOICE_ID?.trim();
    const voiceIdHi = process.env.ELEVENLABS_VOICE_ID_HI?.trim();
    if (!apiKey || !voiceIdEn) {
      return c.json(
        { error: "ElevenLabs TTS not configured", hint: "Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in Backend .env" },
        503
      );
    }

    const body = await c.req.json();
    const { text, locale, skip_translate: skipTranslate } = ttsBodySchema.parse(body);

    let voiceId = voiceIdEn;
    let textForTts = text;

    if (locale === "hi") {
      if (!voiceIdHi) {
        return c.json(
          {
            error: "Hindi TTS not configured",
            hint: "Set ELEVENLABS_VOICE_ID_HI to a premade multilingual voice (free tier: not Voice Library). You may reuse the same premade ID as English.",
          },
          503
        );
      }
      voiceId = voiceIdHi;
      try {
        textForTts =
          skipTranslate || /[\u0900-\u097F]/.test(text)
            ? text
            : await translateEnglishToHindiForSpeech(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("voice tts hindi translate:", msg);
        return c.json(
          {
            error: "Could not translate to Hindi for TTS",
            hint: "Ensure GEMINI_API_KEY is set on the backend for Hindi listen.",
            message: process.env.NODE_ENV === "development" ? msg : undefined,
          },
          502
        );
      }
    }

    const modelId = process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_turbo_v2_5";

    const url = `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: textForTts,
        model_id: modelId,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("ElevenLabs TTS error:", res.status, errText.slice(0, 500));
      const parsed = parseElevenLabsTtsError(errText);
      const paidBlocked =
        res.status === 402 || parsed.code === "paid_plan_required";
      const hint = paidBlocked
        ? "Free plan: Voice Library voices cannot be used via API. Use a premade voice ID in ELEVENLABS_VOICE_ID (e.g. Rachel 21m00Tcm4TlvDq8ikWAM, Adam pNInz6obpgDQGcFmaJgB). List yours: GET https://api.elevenlabs.io/v1/voices with xi-api-key."
        : undefined;
      const statusOut = paidBlocked ? 402 : 502;
      return c.json(
        {
          error: parsed.message || "ElevenLabs TTS request failed",
          hint,
          upstreamStatus: res.status,
          raw: process.env.NODE_ENV === "development" ? errText.slice(0, 300) : undefined,
        },
        statusOut
      );
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    const audioBase64 = Buffer.from(buf).toString("base64");
    return c.json(
      {
        displayText: textForTts,
        mimeType: "audio/mpeg",
        audioBase64,
      },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return c.json({ error: "Invalid body", details: e.errors }, 400);
    }
    console.error("voice tts:", e);
    return c.json({ error: "TTS failed" }, 500);
  }
});

/**
 * GET /api/voice/agent/session
 * Returns WebRTC conversation token (preferred) or public agentId for ElevenAgents.
 */
voiceRouter.get("/voice/agent/session", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
    if (!apiKey || !agentId) {
      return c.json(
        {
          error: "ElevenLabs agent not configured",
          hint: "Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID (from ElevenLabs Agents dashboard)",
        },
        503
      );
    }

    const serverLocation = normalizeElevenLocation(process.env.ELEVENLABS_SERVER_LOCATION);
    const convaiBase = convaiApiV1Base(serverLocation);
    const tokenUrl = `${convaiBase}/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`;
    const timeoutMs = Math.min(
      Math.max(parseInt(process.env.ELEVENLABS_FETCH_TIMEOUT_MS || "25000", 10) || 25000, 5000),
      120000
    );
    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (fetchErr) {
      const err = fetchErr as Error & { cause?: { code?: string; message?: string } };
      const causeCode = err.cause?.code ?? "";
      const combined = `${err.message} ${causeCode} ${err.cause?.message ?? ""}`;
      const isTimeout =
        /timeout|UND_ERR_CONNECT|ETIMEDOUT|ECONNABORTED/i.test(combined);
      console.error("ElevenLabs token fetch failed:", combined.trim());
      return c.json(
        {
          error: isTimeout
            ? "Cannot reach ElevenLabs from this server (connection timed out)"
            : "Cannot reach ElevenLabs from this server",
          hint: "The backend must open outbound HTTPS to api.elevenlabs.io (or your ELEVENLABS_SERVER_LOCATION host). Check firewall, VPN, antivirus, or corporate proxy. From this machine run: curl -v https://api.elevenlabs.io/v1/user (with your API key header) or Test-NetConnection api.elevenlabs.io -Port 443",
          tokenUrlHost: new URL(convaiBase).hostname,
        },
        503
      );
    }

    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) {
        return c.json({
          mode: "webrtc" as const,
          conversationToken: data.token,
          agentId,
          serverLocation,
        });
      }
    }

    const errBody = await res.text().catch(() => "");
    console.warn("ElevenLabs token endpoint:", res.status, errBody.slice(0, 300));

    return c.json({
      mode: "public" as const,
      agentId,
      serverLocation,
      note:
        "Token request failed; try a public agent or check agent auth settings. Client will use agentId only.",
    });
  } catch (e) {
    console.error("voice agent session:", e);
    return c.json({ error: "Failed to prepare agent session" }, 500);
  }
});
