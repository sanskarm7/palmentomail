// llm.ts
//
// Lightweight LLM interpreter for OCR mail results.
// No predefined categories. No hardcoding. No assumptions.
// Gemini describes the mail in its own words.
//
// Designed to be swappable: the interpretMailWithGemini function can be
// replaced with a local LLM wrapper (Ollama, LM Studio, etc.) without
// changing the rest of the pipeline — just match MailInterpretation.

import { GoogleGenAI } from "@google/genai";
import type { OcrResult } from "./ocr";

export interface MailInterpretation {
  senderName: string | null;
  /** The designated recipient of the mail, if visible. */
  recipientName: string | null;
  /** Confidence in senderName, 0.0–1.0. Stored as 0–100 integer in DB. */
  confidence: number;
  /** Free-form label e.g. "insurance flyer", "bank notice", "advertising mailer" */
  mailType: string;
  /** 1–2 sentence human explanation */
  shortSummary: string;
  /** Does this look time-sensitive or financially relevant? */
  isImportant: boolean;
  /** Why the LLM decided that */
  importanceReason: string;
  rawJson?: any;
}

export interface LlmInterpretOptions {
  model?: string;
  temperature?: number;
}

// defaults
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_TEMP = 0.15;

// ---------------------------------------------------------------------------
// Gemini call wrapper
// Tracks per-run call count and retries once on 429 using Gemini's retryDelay.
// No artificial pacing — assumes a paid tier with adequate RPM.
// ---------------------------------------------------------------------------

let callsThisRun = 0;

/** Call at the start of each ingest run to reset the per-run counter. */
export function resetLlmCallCount() {
  callsThisRun = 0;
}

/** Max LLM calls per ingest run. Configurable via LLM_MAX_CALLS_PER_RUN. */
function maxCallsPerRun(): number {
  const v = parseInt(process.env.LLM_MAX_CALLS_PER_RUN ?? "999", 10);
  return isNaN(v) ? 999 : v;
}

/** Sleep for ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wrap a Gemini call: check per-run cap and retry once on 429.
 */
async function rateLimitedCall<T>(fn: () => Promise<T>): Promise<T> {
  if (callsThisRun >= maxCallsPerRun()) {
    throw new Error(
      `LLM per-run cap reached (${maxCallsPerRun()} calls). ` +
      `Adjust LLM_MAX_CALLS_PER_RUN to increase.`
    );
  }

  callsThisRun++;

  try {
    return await fn();
  } catch (err: any) {
    // On 429: parse retryDelay from Gemini's error body and retry once
    const body = typeof err?.message === "string" ? err.message : JSON.stringify(err);
    const delayMatch = body.match(/\"retryDelay\":\"(\d+)s\"/);
    if (delayMatch) {
      const retryMs = (parseInt(delayMatch[1], 10) + 1) * 1000;
      console.log(`[llm] 429 — waiting ${retryMs / 1000}s then retrying...`);
      await sleep(retryMs);
      return await fn();
    }
    throw err;
  }
}

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function interpretMailWithGemini(
  ocr: OcrResult,
  opts: LlmInterpretOptions = {}
): Promise<MailInterpretation> {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("Missing GOOGLE_API_KEY");
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const temperature = opts.temperature ?? DEFAULT_TEMP;

  const prompt = `
You are analyzing OCR text extracted from a physical US mail piece.

Your job:
1. Identify the sender name if possible. If unclear, set "senderName" to null.
2. Identify the designated recipient name if possible. If unclear or "Current Resident", set it exactly as seen or null.
3. Provide a confidence score (0.0–1.0) for your sender identification. Use 0 if senderName is null.
4. Provide a free-form label "mailType" describing what kind of mail this is,
   in natural language. Examples (just examples, you are NOT limited to these):
   - "insurance solicitation"
   - "credit card offer"
   - "bank statement"
   - "advertising flyer"
   - "medical billing notice"
   - "political advertisement"
   - "personal mail"
   - "unclear"
5. Provide a short one–two sentence human-friendly summary.
6. Decide if this mail is important to a typical recipient.
7. Explain in plain English why or why not.

STRICT FORMAT RULES:
- Respond with ONLY a single JSON object, no extra text, no markdown.
- JSON must match this exact shape:

{
  "senderName": string | null,
  "recipientName": string | null,
  "confidence": number,
  "mailType": string,
  "shortSummary": string,
  "isImportant": boolean,
  "importanceReason": string
}

- Do NOT add any other fields.
- Do NOT include double quote (") characters inside string values. If you need quotes, use single quotes (').
- Keep "shortSummary" under 200 characters.
- Keep "importanceReason" under 200 characters.
- Do not include line breaks inside any string values.

Here is the OCR result as JSON:

${JSON.stringify(ocr, null, 2)}
`.trim();

  const response = await rateLimitedCall(() =>
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature, maxOutputTokens: 1000 },
    })
  );

  const text = response.text?.trim();

  if (!text) {
    console.error("Gemini returned no text");
    return {
      senderName: null,
      recipientName: null,
      confidence: 0,
      mailType: "unknown",
      shortSummary: "LLM returned no analysis for this mail piece.",
      isImportant: false,
      importanceReason: "No LLM output was returned.",
      rawJson: null,
    };
  }

  const json = safeParseJSON(text);

  if (!json || typeof json !== "object") {
    console.error("Gemini JSON parse failed, falling back to generic interpretation");
    return {
      senderName: null,
      recipientName: null,
      confidence: 0,
      mailType: "unknown",
      shortSummary: "LLM could not reliably interpret this mail piece.",
      isImportant: false,
      importanceReason: "Failed to parse LLM JSON response.",
      rawJson: json,
    };
  }

  const rawConfidence = typeof json.confidence === "number" ? json.confidence : 0;
  // Clamp to [0, 1]
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  return {
    senderName: json.senderName ?? null,
    recipientName: json.recipientName ?? null,
    confidence,
    mailType: String(json.mailType ?? "unknown"),
    shortSummary: String(json.shortSummary ?? ""),
    isImportant: Boolean(json.isImportant),
    importanceReason: String(json.importanceReason ?? ""),
    rawJson: json,
  };
}

function safeParseJSON(str: string): any | null {
  let cleaned = str.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");
    const idx = cleaned.lastIndexOf("```");
    if (idx !== -1) cleaned = cleaned.slice(0, idx);
    cleaned = cleaned.trim();
  }

  // Try to isolate the JSON object if there's extra noise
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1).trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse Gemini JSON:", cleaned, err);
    return null;
  }
}

/**
 * Vision path: send the raw image directly to Gemini without running OCR first.
 * Enabled when LLM_VISION_MODE=1 in the environment.
 * Returns the same MailInterpretation shape as interpretMailWithGemini.
 */
export async function interpretMailWithGeminiVision(
  imageBuffer: Buffer,
  opts: LlmInterpretOptions = {}
): Promise<MailInterpretation> {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("Missing GOOGLE_API_KEY");
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const temperature = opts.temperature ?? DEFAULT_TEMP;

  const prompt = `
You are analyzing an image of a physical US mail piece (scanned front of an envelope or mailer).

Your job:
1. Identify the sender name if visible. If unclear, set "senderName" to null.
2. Identify the designated recipient name if visible. If unclear or "Current Resident", set it exactly as seen or null.
3. Provide a confidence score (0.0–1.0) for your sender identification. Use 0 if senderName is null.
4. Provide a free-form label "mailType" describing what kind of mail this is.
   Examples: "insurance solicitation", "credit card offer", "bank statement",
   "advertising flyer", "medical billing notice", "political advertisement",
   "personal mail", "unclear"
5. Provide a short one–two sentence human-friendly summary.
6. Decide if this mail is important to a typical recipient.
7. Explain in plain English why or why not.

STRICT FORMAT RULES:
- Respond with ONLY a single JSON object, no extra text, no markdown.
- JSON must match this exact shape:

{
  "senderName": string | null,
  "recipientName": string | null,
  "confidence": number,
  "mailType": string,
  "shortSummary": string,
  "isImportant": boolean,
  "importanceReason": string
}

- Do NOT add any other fields.
- Do NOT include double quote (") characters inside string values. Use single quotes instead.
- Keep "shortSummary" under 200 characters.
- Keep "importanceReason" under 200 characters.
- Do not include line breaks inside any string values.
`.trim();

  const base64Image = imageBuffer.toString("base64");

  const response = await rateLimitedCall(() =>
    ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: base64Image } },
            { text: prompt },
          ],
        },
      ],
      config: { temperature, maxOutputTokens: 1000 },
    })
  );

  const text = response.text?.trim();

  if (!text) {
    console.error("[vision] Gemini returned no text");
    return {
      senderName: null,
      recipientName: null,
      confidence: 0,
      mailType: "unknown",
      shortSummary: "Vision LLM returned no analysis.",
      isImportant: false,
      importanceReason: "No LLM output was returned.",
      rawJson: null,
    };
  }

  const json = safeParseJSON(text);

  if (!json || typeof json !== "object") {
    console.error("[vision] Gemini JSON parse failed:", text.slice(0, 200));
    return {
      senderName: null,
      recipientName: null,
      confidence: 0,
      mailType: "unknown",
      shortSummary: "Vision LLM could not reliably interpret this mail piece.",
      isImportant: false,
      importanceReason: "Failed to parse LLM JSON response.",
      rawJson: null,
    };
  }

  const rawConfidence = typeof json.confidence === "number" ? json.confidence : 0;
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  return {
    senderName: json.senderName ?? null,
    recipientName: json.recipientName ?? null,
    confidence,
    mailType: String(json.mailType ?? "unknown"),
    shortSummary: String(json.shortSummary ?? ""),
    isImportant: Boolean(json.isImportant),
    importanceReason: String(json.importanceReason ?? ""),
    rawJson: json,
  };
}
