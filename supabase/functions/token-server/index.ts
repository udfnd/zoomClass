import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

type PersistResult =
  | { success: true; meeting: JsonRecord | null; warning?: "missing_optional_columns" }
  | { success: false; reason: "not_configured" | "invalid_input" | "storage_failed"; message?: string };

type SupabaseClient = ReturnType<typeof createClient>;

const env = Deno.env.toObject();
const SDK_KEY = env.ZOOM_SDK_KEY ?? "";
const SDK_SECRET = env.ZOOM_SDK_SECRET ?? "";
const SUPABASE_URL = env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function toBase64Url(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return toBase64Url(binary);
}

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeDateInput(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    const isoLike = trimmed.replace(/ /g, "T");
    const reparsed = new Date(isoLike);
    return Number.isNaN(reparsed.getTime()) ? null : reparsed;
  }

  return null;
}

function ensureSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
}

async function generateMeetingSignature(meetingNumber: number | string, role: number) {
  if (!SDK_KEY || !SDK_SECRET) {
    throw new Error("Meeting SDK 자격 증명이 필요합니다.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expires = issuedAt + 60 * 60 * 2;

  const header = toBase64Url(
    JSON.stringify({
      alg: "HS256",
      typ: "JWT",
    }),
  );
  const payload = toBase64Url(
    JSON.stringify({
      sdkKey: SDK_KEY,
      appKey: SDK_KEY,
      mn: Number(meetingNumber),
      role,
      iat: issuedAt,
      exp: expires,
      tokenExp: expires,
    }),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SDK_SECRET),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
  const signature = bytesToBase64Url(signatureBytes);
  return `${header}.${payload}.${signature}`;
}

async function persistMeeting(
  client: SupabaseClient,
  {
    sessionName,
    hostName,
    startTime,
    meetingNumber,
    joinUrl,
    startUrl,
    passcode,
  }: {
    sessionName?: unknown;
    hostName?: unknown;
    startTime?: unknown;
    meetingNumber?: unknown;
    joinUrl?: unknown;
    startUrl?: unknown;
    passcode?: unknown;
  },
): Promise<PersistResult> {
  const normalizedSession = typeof sessionName === "string" ? sessionName.trim() : "";
  const normalizedHost = typeof hostName === "string" ? hostName.trim() : "";
  const normalizedStart = normalizeDateInput(startTime);

  if (!normalizedSession || !normalizedHost || !normalizedStart) {
    return { success: false, reason: "invalid_input", message: "Invalid or missing meeting payload." };
  }

  const baseRecord: JsonRecord = {
    session_name: normalizedSession,
    host_name: normalizedHost,
    start_time: normalizedStart.toISOString(),
  };

  const optionalFields: JsonRecord = {};
  if (meetingNumber) {
    optionalFields.zoom_meeting_id = String(meetingNumber);
  }
  if (typeof joinUrl === "string" && joinUrl.trim()) {
    optionalFields.zoom_join_url = joinUrl.trim();
  }
  if (typeof startUrl === "string" && startUrl.trim()) {
    optionalFields.zoom_start_url = startUrl.trim();
  }
  if (typeof passcode === "string" && passcode.trim()) {
    optionalFields.zoom_passcode = passcode.trim();
  }

  const payloadWithOptional = { ...baseRecord, ...optionalFields };

  const attempts: Array<{
    type: "upsert" | "insert_optional" | "insert_base";
    payload: JsonRecord;
  }> = [
    { type: "upsert", payload: payloadWithOptional },
    { type: "insert_optional", payload: payloadWithOptional },
    { type: "insert_base", payload: baseRecord },
  ];

  let lastError: Error | null = null;
  let optionalColumnsMissing = false;
  for (const attempt of attempts) {
    try {
      let result;
      if (attempt.type === "upsert") {
        result = await client
          .from("meetings")
          .upsert(attempt.payload, { onConflict: "session_name,start_time", ignoreDuplicates: false })
          .select()
          .maybeSingle();
      } else {
        result = await client.from("meetings").insert(attempt.payload).select().maybeSingle();
      }

      if (result.error) {
        lastError = result.error;
        const message = result.error.message ?? "";
        const columnMissing = /column .* does not exist/i.test(message);
        const conflictUnsupported = /on conflict/i.test(message);

        if (columnMissing && attempt.type !== "insert_base" && Object.keys(optionalFields).length > 0) {
          optionalColumnsMissing = true;
          continue;
        }

        if (attempt.type === "upsert" && conflictUnsupported) {
          continue;
        }

        continue;
      }

      return {
        success: true,
        meeting: result.data ?? null,
        warning: optionalColumnsMissing ? "missing_optional_columns" : undefined,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  return {
    success: false,
    reason: "storage_failed",
    message: lastError?.message ?? "Unknown Supabase error",
  };
}

async function createMeetingSignature(req: Request) {
  const body = await req.json().catch(() => null);
  const meetingNumber = body?.meetingNumber ?? body?.mn;
  const role = Number(body?.role ?? 0);

  if (!meetingNumber) {
    return jsonResponse({ error: "meetingNumber 파라미터가 필요합니다." }, 400);
  }

  const signature = await generateMeetingSignature(meetingNumber, role);
  return jsonResponse({ signature });
}

async function listMeetings(req: Request) {
  const client = ensureSupabaseClient();
  if (!client) {
    return jsonResponse({ error: "Supabase 미구성" }, 500);
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const range = url.searchParams.get("range");
  const limitParam = url.searchParams.get("limit");

  let query = client.from("meetings").select("*").order("start_time", { ascending: true });

  if (date) {
    const dayStart = normalizeDateInput(`${date}T00:00:00`);
    if (dayStart) {
      const endOfDay = new Date(dayStart.getTime());
      endOfDay.setDate(endOfDay.getDate() + 1);
      query = query.gte("start_time", dayStart.toISOString()).lt("start_time", endOfDay.toISOString());
    }
  } else if (range === "upcoming") {
    query = query.gte("start_time", new Date().toISOString());
  }

  const limit = Number(limitParam);
  if (Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ meetings: data ?? [] });
}

async function createMeetingRecord(req: Request) {
  const client = ensureSupabaseClient();
  if (!client) {
    return jsonResponse({ error: "Supabase 미구성" }, 500);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "유효한 JSON 요청 본문이 필요합니다." }, 400);
  }

  const result = await persistMeeting(client, body as JsonRecord);
  if (!result.success) {
    if (result.reason === "invalid_input") {
      return jsonResponse({ error: "sessionName, hostName, startTime 값이 필요합니다." }, 400);
    }
    return jsonResponse({ error: result.message ?? "Supabase 저장에 실패했습니다." }, 500);
  }

  const status = result.warning === "missing_optional_columns" ? 207 : 201;
  const payload: JsonRecord = { meeting: result.meeting };
  if (result.warning === "missing_optional_columns") {
    payload.warning = "missing_optional_columns";
  }

  return jsonResponse(payload, status);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname === "/sign") {
    try {
      return await createMeetingSignature(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500);
    }
  }

  if (req.method === "GET" && url.pathname === "/meetings") {
    return await listMeetings(req);
  }

  if (req.method === "POST" && url.pathname === "/meetings") {
    return await createMeetingRecord(req);
  }

  return new Response("Not found", { status: 404 });
});
