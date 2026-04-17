import { getClaudeClient } from "../../finance/lib/claude-client";
import type Anthropic from "@anthropic-ai/sdk";

export interface ExtractedHealthMetric {
  metricType: string; // steps, sleep_duration, heart_rate_resting, weight, active_calories, exercise_minutes, flights_climbed, distance, workout, heart_rate_variability
  value: number;
  unit: string; // count, min, bpm, kg, lb, kcal, km, mi, ms
  recordDate: string; // YYYY-MM-DD
  startTime?: string; // ISO 8601
  endTime?: string; // ISO 8601
  source?: string; // Apple Watch, iPhone, etc.
  workoutType?: string; // running, cycling, swimming, etc.
}

export interface ParsedHealthData {
  metrics: ExtractedHealthMetric[];
  dataRange: { start: string; end: string } | null;
  deviceSources: string[];
}

const SYSTEM_PROMPT = `You are a health data parser. Extract health metrics from the provided Apple Health export data into structured JSON.

The input is XML from Apple Health's export.xml file. Extract these metric types:

- steps (HKQuantityTypeIdentifierStepCount) — daily total, unit: "count"
- sleep_duration (HKCategoryTypeIdentifierSleepAnalysis) — compute total sleep per night from InBed/Asleep records, unit: "min"
- heart_rate_resting (HKQuantityTypeIdentifierRestingHeartRate) — unit: "bpm"
- heart_rate_variability (HKQuantityTypeIdentifierHeartRateVariabilitySDNN) — unit: "ms"
- weight (HKQuantityTypeIdentifierBodyMass) — unit: "kg" (convert from lb if needed: divide by 2.205)
- active_calories (HKQuantityTypeIdentifierActiveEnergyBurned) — daily total, unit: "kcal"
- exercise_minutes (HKQuantityTypeIdentifierAppleExerciseTime) — daily total, unit: "min"
- flights_climbed (HKQuantityTypeIdentifierFlightsClimbed) — daily total, unit: "count"
- distance (HKQuantityTypeIdentifierDistanceWalkingRunning) — daily total, unit: "km" (convert from mi if needed: multiply by 1.609)
- workout (HKWorkoutActivityType*) — individual workouts, unit: "min" for duration

Rules:
- Aggregate step counts, calories, exercise minutes, flights, and distance into DAILY totals (one record per day)
- For sleep, compute total sleep duration per night (sum all Asleep/InBed segments between 6pm–12pm next day)
- For heart rate & weight, take one reading per day (latest in the day)
- Dates must be YYYY-MM-DD format
- Include startTime/endTime as ISO 8601 strings for sleep and workout records
- For workouts, set workoutType to the activity (running, cycling, swimming, strength_training, yoga, hiking, walking, etc.)
- If the export is very large, focus on the MOST RECENT 90 days of data
- Convert all units to metric (kg, km)

Return ONLY valid JSON matching this schema:
{
  "data_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } or null,
  "device_sources": ["Apple Watch", "iPhone"],
  "metrics": [
    {
      "metric_type": "steps",
      "value": 8432,
      "unit": "count",
      "record_date": "YYYY-MM-DD",
      "start_time": "ISO8601 or null",
      "end_time": "ISO8601 or null",
      "source": "Apple Watch",
      "workout_type": "null or workout activity type"
    }
  ]
}

Do not include any explanation, markdown formatting, or text outside the JSON.`;

/**
 * Parses an Apple Health export file using Claude API.
 * Supports: XML (from export.xml), CSV, or text health data.
 */
export async function parseHealthExport(params: {
  fileType: "xml" | "csv" | "text" | "pdf" | "image";
  fileContent: Buffer | string;
  filename?: string;
}): Promise<ParsedHealthData> {
  const client = getClaudeClient();

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] =
    buildMessageContent(params);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const jsonText = extractJson(textBlock.text);
  let parsed: {
    data_range?: { start: string; end: string } | null;
    device_sources?: string[];
    metrics: Array<{
      metric_type: string;
      value: number;
      unit: string;
      record_date: string;
      start_time?: string | null;
      end_time?: string | null;
      source?: string | null;
      workout_type?: string | null;
    }>;
  };

  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.error("Claude returned invalid JSON:", textBlock.text.slice(0, 500));
    throw new Error(`Failed to parse Claude response as JSON: ${err}`);
  }

  return {
    dataRange: parsed.data_range ?? null,
    deviceSources: parsed.device_sources ?? [],
    metrics: (parsed.metrics ?? []).map((m) => ({
      metricType: m.metric_type,
      value: m.value,
      unit: m.unit,
      recordDate: m.record_date,
      startTime: m.start_time ?? undefined,
      endTime: m.end_time ?? undefined,
      source: m.source ?? undefined,
      workoutType: m.workout_type ?? undefined,
    })),
  };
}

function buildMessageContent(params: {
  fileType: "xml" | "csv" | "text" | "pdf" | "image";
  fileContent: Buffer | string;
  filename?: string;
}): Anthropic.MessageCreateParams["messages"][0]["content"] {
  const { fileType, fileContent, filename } = params;

  if (fileType === "pdf") {
    const base64 =
      typeof fileContent === "string"
        ? fileContent
        : fileContent.toString("base64");
    return [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      },
      {
        type: "text",
        text: `Parse this health data export${filename ? ` (${filename})` : ""} and extract all health metrics.`,
      },
    ];
  }

  if (fileType === "image") {
    const base64 =
      typeof fileContent === "string"
        ? fileContent
        : fileContent.toString("base64");
    return [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: base64 },
      },
      {
        type: "text",
        text: `Parse this health data screenshot${filename ? ` (${filename})` : ""} and extract all health metrics.`,
      },
    ];
  }

  // XML, CSV, or text — send as plain text
  // For large XML files, truncate to avoid token limits (~200KB of text)
  let text =
    typeof fileContent === "string" ? fileContent : fileContent.toString("utf-8");

  const MAX_CHARS = 200_000;
  if (text.length > MAX_CHARS) {
    // Take the last portion (most recent data) plus the header
    const headerEnd = text.indexOf("</ExportDate>") + 20;
    const header = text.slice(0, Math.min(headerEnd, 500));
    text = header + "\n<!-- truncated -->\n" + text.slice(-MAX_CHARS);
  }

  return [
    {
      type: "text",
      text: `Parse this Apple Health export${filename ? ` (${filename})` : ""} and extract all health metrics.\n\n---\n\n${text}`,
    },
  ];
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}
