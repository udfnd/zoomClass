import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

type PersistResult =
  | { success: true; meeting: JsonRecord | null; warning?: "missing_optional_columns" }
  | { success: false; reason: "not_configured" | "invalid_input" | "storage_failed"; message?: string };

type SupabaseClient = ReturnType<typeof createClient>;

const env = Deno.env.toObject();

function sanitizeEnvValue(key: string, value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  let sanitized = value.trim();

  if (sanitized.startsWith("\"") && sanitized.endsWith("\"")) {
    sanitized = sanitized.slice(1, -1).trim();
  } else if (sanitized.startsWith("'") && sanitized.endsWith("'")) {
    sanitized = sanitized.slice(1, -1).trim();
  }

  if (/copy$/i.test(sanitized)) {
    const trimmed = sanitized.slice(0, -4).trim();
    if (trimmed) {
      console.warn(
        `[token-server] ${key} 값 끝에 불필요한 'Copy' 텍스트가 감지되어 제거했습니다. 환경 변수를 다시 확인해주세요.`,
      );
      sanitized = trimmed;
    }
  }

  return sanitized;
}

const SDK_KEY = sanitizeEnvValue("ZOOM_SDK_KEY", env.ZOOM_SDK_KEY);
const SDK_SECRET = sanitizeEnvValue("ZOOM_SDK_SECRET", env.ZOOM_SDK_SECRET);
const SUPABASE_URL = sanitizeEnvValue("SUPABASE_URL", env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = sanitizeEnvValue(
  "SUPABASE_SERVICE_ROLE_KEY",
  env.SUPABASE_SERVICE_ROLE_KEY,
);
const ZOOM_ACCOUNT_ID = sanitizeEnvValue("ZOOM_ACCOUNT_ID", env.ZOOM_ACCOUNT_ID);
const ZOOM_CLIENT_ID = sanitizeEnvValue("ZOOM_CLIENT_ID", env.ZOOM_CLIENT_ID);
const ZOOM_CLIENT_SECRET = sanitizeEnvValue("ZOOM_CLIENT_SECRET", env.ZOOM_CLIENT_SECRET);
const ZOOM_API_KEY = sanitizeEnvValue("ZOOM_API_KEY", env.ZOOM_API_KEY);
const ZOOM_API_SECRET = sanitizeEnvValue("ZOOM_API_SECRET", env.ZOOM_API_SECRET);

const ALLOWED_ORIGIN = sanitizeEnvValue("CORS_ALLOWED_ORIGIN", env.CORS_ALLOWED_ORIGIN);
const DEFAULT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

if (ALLOWED_ORIGIN) {
  DEFAULT_CORS_HEADERS["Access-Control-Allow-Credentials"] = "true";
}

function withCorsHeaders(headers: HeadersInit = {}): HeadersInit {
  let normalized: Record<string, string> = {};

  if (headers instanceof Headers) {
    normalized = Object.fromEntries(headers.entries());
  } else if (Array.isArray(headers)) {
    normalized = headers.reduce<Record<string, string>>((acc, [key, value]) => {
      if (key) {
        acc[key] = value;
      }
      return acc;
    }, {});
  } else if (headers && typeof headers === "object") {
    normalized = { ...(headers as Record<string, string>) };
  }

  return {
    ...DEFAULT_CORS_HEADERS,
    ...normalized,
  };
}

const isZoomOAuthConfigured = () => Boolean(ZOOM_ACCOUNT_ID && ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET);
const isZoomJwtConfigured = () => Boolean(ZOOM_API_KEY && ZOOM_API_SECRET);
const isZoomApiAccessConfigured = () => isZoomOAuthConfigured() || isZoomJwtConfigured();

type ZoomAuthInfo = { type: "oauth" | "jwt"; token: string; headerValue: string };
type ZoomUserProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

let zoomOAuthTokenCache: { token: string; expiresAt: number } = { token: "", expiresAt: 0 };
let zoomUserProfileCache: { profile: ZoomUserProfile | null; expiresAt: number } = {
  profile: null,
  expiresAt: 0,
};

function toBase64Url(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return toBase64Url(binary);
}

async function hmacSha256Base64Url(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(signature);
}

function ensureMeetingSdkConfigured() {
  if (!SDK_KEY || !SDK_SECRET) {
    throw new Error("ZOOM_SDK_KEY 또는 ZOOM_SDK_SECRET 환경 변수가 필요합니다.");
  }
}

function ensureZoomApiAccessConfigured() {
  if (!isZoomApiAccessConfigured()) {
    throw new Error(
      "Zoom API 호출을 위해 ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET 또는 ZOOM_API_KEY, ZOOM_API_SECRET 값을 설정해주세요.",
    );
  }
}

function resetZoomOAuthCache() {
  zoomOAuthTokenCache = { token: "", expiresAt: 0 };
  zoomUserProfileCache = { profile: null, expiresAt: 0 };
}

async function fetchZoomOAuthAccessToken({ forceRefresh = false } = {}) {
  if (!isZoomOAuthConfigured()) {
    throw new Error("Zoom OAuth 자격 증명이 구성되어 있지 않습니다.");
  }

  const now = Date.now();
  if (!forceRefresh && zoomOAuthTokenCache.token && now < zoomOAuthTokenCache.expiresAt) {
    return zoomOAuthTokenCache.token;
  }

  if (forceRefresh) {
    resetZoomOAuthCache();
  }

  const basicAuth = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const requestParams = new URLSearchParams({
    grant_type: "account_credentials",
    account_id: ZOOM_ACCOUNT_ID,
  });

  const tokenUrl = `https://zoom.us/oauth/token?${requestParams.toString()}`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
    },
  });

  const responseText = await response.text();

  if (!response.ok) {
    resetZoomOAuthCache();

    let detailedMessage = `Zoom OAuth 토큰 발급 실패: ${response.status} ${response.statusText} - ${responseText}`;
    try {
      const errorPayload = responseText ? JSON.parse(responseText) : null;
      if (errorPayload?.error === "unsupported_grant_type") {
        detailedMessage +=
          " (grant_type=account_credentials 요청이 거부되었습니다. Server-to-Server OAuth 앱이 활성화되어 있고 account_id 값이 올바른지 확인해주세요.)";
      }
    } catch {
      // ignore JSON parse error – responseText will be included above
    }

    throw new Error(detailedMessage);
  }

  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`Zoom OAuth 응답을 JSON으로 파싱하지 못했습니다: ${message}`);
  }

  if (!data.access_token) {
    resetZoomOAuthCache();
    throw new Error("Zoom OAuth 응답에 access_token이 없습니다.");
  }

  const expiresInSeconds = Number(data.expires_in);
  const expiresInMs = Number.isFinite(expiresInSeconds) ? Math.max(0, expiresInSeconds * 1000) : 0;
  const safetyWindowMs = Math.min(60000, Math.floor(expiresInMs * 0.1));
  const computedExpiry = Date.now() + Math.max(0, expiresInMs - safetyWindowMs);

  zoomOAuthTokenCache = {
    token: data.access_token,
    expiresAt: computedExpiry,
  };

  return zoomOAuthTokenCache.token;
}

async function createZoomJwtToken() {
  if (!isZoomJwtConfigured()) {
    throw new Error("Zoom JWT 자격 증명이 구성되어 있지 않습니다.");
  }

  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: ZOOM_API_KEY,
      exp: Math.floor(Date.now() / 1000) + 60 * 5,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const signature = await hmacSha256Base64Url(ZOOM_API_SECRET, `${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

async function getZoomApiAuthInfo({ forceRefresh = false } = {}): Promise<ZoomAuthInfo> {
  if (isZoomOAuthConfigured()) {
    const accessToken = await fetchZoomOAuthAccessToken({ forceRefresh });
    return { type: "oauth", token: accessToken, headerValue: `Bearer ${accessToken}` };
  }

  if (isZoomJwtConfigured()) {
    const jwt = await createZoomJwtToken();
    return { type: "jwt", token: jwt, headerValue: `Bearer ${jwt}` };
  }

  throw new Error("Zoom API 호출 자격 증명이 구성되어 있지 않습니다.");
}

async function fetchZoomZakToken(authInfo?: ZoomAuthInfo) {
  ensureZoomApiAccessConfigured();

  let resolvedAuthInfo = authInfo ?? (await getZoomApiAuthInfo());

  const performZakRequest = (authorizationHeader: string) =>
    fetch("https://api.zoom.us/v2/users/me/token?type=zak", {
      headers: {
        Authorization: authorizationHeader,
      },
    });

  let response = await performZakRequest(resolvedAuthInfo.headerValue);

  if (response.status === 401 && resolvedAuthInfo.type === "oauth") {
    try {
      const refreshedAuthInfo = await getZoomApiAuthInfo({ forceRefresh: true });
      const retryResponse = await performZakRequest(refreshedAuthInfo.headerValue);
      if (retryResponse.ok) {
        response = retryResponse;
        resolvedAuthInfo = refreshedAuthInfo;
      }
    } catch (refreshError) {
      console.error("[token-server] Failed to refresh Zoom OAuth token after 401 ZAK response:", refreshError);
    }
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Zoom ZAK 토큰 발급 실패: ${response.status} ${response.statusText} - ${bodyText}`);
  }

  const data = await response.json();
  if (!data || !data.token) {
    throw new Error("Zoom ZAK 응답에 token 필드가 없습니다.");
  }

  return {
    zak: data.token as string,
    expiresIn: (data.expires_in as number | undefined) ?? null,
  };
}

async function getZoomUserProfile(authInfo?: ZoomAuthInfo, { forceRefresh = false } = {}) {
  ensureZoomApiAccessConfigured();

  const now = Date.now();
  if (!forceRefresh && zoomUserProfileCache.profile && now < zoomUserProfileCache.expiresAt) {
    return zoomUserProfileCache.profile;
  }

  let resolvedAuthInfo = authInfo ?? (await getZoomApiAuthInfo());

  const performProfileRequest = (authorizationHeader: string) =>
    fetch("https://api.zoom.us/v2/users/me", {
      headers: {
        Authorization: authorizationHeader,
      },
    });

  let response = await performProfileRequest(resolvedAuthInfo.headerValue);

  if (response.status === 401 && resolvedAuthInfo.type === "oauth") {
    try {
      const refreshedAuthInfo = await getZoomApiAuthInfo({ forceRefresh: true });
      const retryResponse = await performProfileRequest(refreshedAuthInfo.headerValue);
      if (retryResponse.ok) {
        response = retryResponse;
        resolvedAuthInfo = refreshedAuthInfo;
      }
    } catch (refreshError) {
      console.error(
        "[token-server] Failed to refresh Zoom OAuth token after 401 profile response:",
        refreshError,
      );
    }
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Zoom 사용자 정보 조회 실패: ${response.status} ${response.statusText} - ${bodyText}`);
  }

  const data = await response.json();
  if (!data || (!data.email && !data.user_email)) {
    throw new Error("Zoom 사용자 정보 응답에 email 필드가 없습니다.");
  }

  const profile: ZoomUserProfile = {
    id: (data.id as string) || (data.user_id as string) || "",
    email: (data.email as string) || (data.user_email as string) || "",
    firstName: (data.first_name as string) || "",
    lastName: (data.last_name as string) || "",
    displayName: (data.display_name as string) || (data.user_display_name as string) || "",
  };

  const ttlMs = 5 * 60 * 1000;
  zoomUserProfileCache = { profile, expiresAt: Date.now() + ttlMs };

  return profile;
}

function stripMilliseconds(isoString: string) {
  if (typeof isoString !== "string") {
    return "";
  }
  return isoString.replace(/\.\d{3}Z$/, "Z");
}

function extractZakFromZoomUrl(url: unknown) {
  if (typeof url !== "string" || !url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    const zakParam = parsed.searchParams.get("zak");
    if (zakParam) {
      return zakParam;
    }
  } catch (error) {
    console.warn("[token-server] Failed to parse start_url as URL when extracting ZAK:", error);
  }

  const match = url.match(/[?&#]zak=([^&#]+)/);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch (decodeError) {
      console.warn("[token-server] Failed to decode ZAK extracted from start_url:", decodeError);
      return match[1];
    }
  }

  return "";
}

async function createZoomMeeting({
  topic,
  hostName,
  startTime,
  durationMinutes,
}: {
  topic: string;
  hostName: string;
  startTime?: unknown;
  durationMinutes?: number;
}) {
  ensureZoomApiAccessConfigured();

  let authInfo = await getZoomApiAuthInfo();

  const normalizedStart = normalizeDateInput(startTime);
  const sanitizedDuration = Number.isFinite(durationMinutes) ? Math.max(1, Math.round(Number(durationMinutes))) : undefined;

  const payload: Record<string, unknown> = {
    topic: topic || "ZoomClass Session",
    type: normalizedStart ? 2 : 1,
    agenda: hostName ? `Host: ${hostName}` : undefined,
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      waiting_room: false,
    },
  };

  if (normalizedStart) {
    payload.start_time = stripMilliseconds(normalizedStart.toISOString());
    payload.timezone = "UTC";
    if (sanitizedDuration) {
      payload.duration = sanitizedDuration;
    }
  }

  const buildErrorMessage = async (response: Response) => {
    const bodyText = await response.text();
    if (response.status === 401) {
      return [
        "Zoom 회의 생성 실패: 401 Unauthorized - Zoom 자격 증명이 올바른지 확인해주세요.",
        bodyText,
        "Server-to-Server OAuth 앱이 meeting:write:admin 권한을 갖고 있는지 확인하고,",
        "환경 변수에 불필요한 공백이나 Copy 같은 추가 텍스트가 포함되어 있지 않은지 점검해주세요.",
      ]
        .filter(Boolean)
        .join(" ");
    }
    return `Zoom 회의 생성 실패: ${response.status} ${response.statusText} - ${bodyText}`;
  };

  const performCreateRequest = (authorization: string) =>
    fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(payload),
    });

  let response = await performCreateRequest(authInfo.headerValue);

  if (response.status === 401 && authInfo.type === "oauth") {
    try {
      const refreshedAuthInfo = await getZoomApiAuthInfo({ forceRefresh: true });
      const retryResponse = await performCreateRequest(refreshedAuthInfo.headerValue);
      if (retryResponse.ok) {
        response = retryResponse;
        authInfo = refreshedAuthInfo;
      }
    } catch (refreshError) {
      console.error("[token-server] Failed to refresh Zoom OAuth token after 401 response:", refreshError);
    }
  }

  if (!response.ok) {
    throw new Error(await buildErrorMessage(response));
  }

  const data = await response.json();
  if (!data || !data.id) {
    throw new Error("Zoom 회의 생성 응답에 회의 ID가 없습니다.");
  }

  let zakInfo: { zak: string; expiresIn: number | null } | null = null;
  let zakSource: string | null = null;
  let hostProfile: ZoomUserProfile | null = null;
  try {
    const fetchedZak = await fetchZoomZakToken(authInfo);
    if (fetchedZak?.zak) {
      zakInfo = { zak: fetchedZak.zak, expiresIn: fetchedZak.expiresIn ?? null };
      zakSource = "user_token_endpoint";
    }
  } catch (zakError) {
    console.warn("[token-server] Failed to issue ZAK token for host session:", zakError);
  }

  try {
    hostProfile = await getZoomUserProfile(authInfo);
  } catch (profileError) {
    console.warn("[token-server] Failed to fetch Zoom host profile:", profileError);
  }

  let startUrlZak = "";
  if (!zakInfo?.zak && typeof data.start_url === "string") {
    startUrlZak = extractZakFromZoomUrl(data.start_url);
    if (startUrlZak) {
      zakSource = "start_url";
    }
  }

  const resolvedZak = zakInfo?.zak || startUrlZak || "";

  return {
    meeting: data as Record<string, unknown>,
    zak: resolvedZak,
    zakExpiresIn: zakInfo?.expiresIn ?? null,
    zakSource,
    hostProfile,
  };
}

function escapeHtml(value = "") {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildBackendBase(url: URL, basePath: string) {
  const normalizedBase = basePath.replace(/\/+$/, "");
  if (!normalizedBase) {
    return url.origin;
  }
  return `${url.origin}${normalizedBase}`;
}

function buildJoinHelperUrl(
  requestUrl: URL,
  basePath: string,
  {
    meetingNumber,
    passcode,
    topic,
    hostName,
    backendBase,
  }: {
    meetingNumber: string;
    passcode?: string;
    topic?: string;
    hostName?: string;
    backendBase?: string;
  },
) {
  const trimmedBase = basePath.replace(/\/+$/, "");
  const joinPath = `${trimmedBase}/join`;
  const normalizedJoinPath = joinPath.startsWith("/") ? joinPath : `/${joinPath}`;
  const joinUrl = new URL(requestUrl.toString());
  joinUrl.pathname = normalizedJoinPath.replace(/\/+$/, "");
  joinUrl.search = "";
  joinUrl.searchParams.set("meetingNumber", meetingNumber);
  if (passcode) {
    joinUrl.searchParams.set("passcode", passcode);
  }
  if (topic) {
    joinUrl.searchParams.set("topic", topic);
  }
  if (hostName) {
    joinUrl.searchParams.set("hostName", hostName);
  }
  if (backendBase) {
    joinUrl.searchParams.set("backendUrl", backendBase);
  }
  return joinUrl.toString();
}

function resolvePathInfo(url: URL) {
  const normalized = url.pathname.replace(/\/+$/, "") || "/";
  const tokenServerIndex = normalized.indexOf("/token-server");
  if (tokenServerIndex === -1) {
    return {
      basePath: "",
      relativePath: normalized || "/",
    };
  }

  const basePath = normalized.slice(0, tokenServerIndex + "/token-server".length);
  let relativePath = normalized.slice(basePath.length);
  if (!relativePath) {
    relativePath = "/";
  }
  if (!relativePath.startsWith("/")) {
    relativePath = `/${relativePath}`;
  }

  return { basePath, relativePath };
}

function decodeBase64UrlJson(segment: string) {
  if (!segment) {
    return null;
  }

  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const decoded = atob(base64 + padding);
  return JSON.parse(decoded);
}

function decodeMeetingSignature(signature: string) {
  if (typeof signature !== "string" || !signature.includes(".")) {
    throw new Error("유효한 Meeting SDK 서명 형식이 아닙니다.");
  }

  const [headerSegment, payloadSegment] = signature.split(".");
  return {
    header: decodeBase64UrlJson(headerSegment),
    payload: decodeBase64UrlJson(payloadSegment),
  };
}

async function renderJoinHelper(req: Request, url: URL, basePath: string) {
  const meetingNumber =
    (url.searchParams.get("meetingNumber") ??
      url.searchParams.get("mn") ??
      url.searchParams.get("meeting") ??
      url.searchParams.get("sessionNumber") ??
      "").trim();

  if (!meetingNumber) {
    return jsonResponse({ error: "meetingNumber query parameter is required." }, 400);
  }

  const passcode =
    (url.searchParams.get("passcode") ??
      url.searchParams.get("pwd") ??
      url.searchParams.get("password") ??
      "").trim();
  const topic = (url.searchParams.get("topic") ?? url.searchParams.get("sessionName") ?? "").trim();
  const backendParam = (url.searchParams.get("backendUrl") ?? url.searchParams.get("backend") ?? "").trim();
  let backendBase = backendParam.replace(/\/+$/, "");
  if (!backendBase) {
    backendBase = buildBackendBase(url, basePath);
  }

  const joinUrl = url.toString();
  const acceptHeader = req.headers.get("accept") ?? "";
  const prefersJson = acceptHeader.includes("application/json") && !acceptHeader.includes("text/html");

  if (prefersJson) {
    return jsonResponse({ meetingNumber, passcode, topic, backendUrl: backendBase, joinUrl });
  }

  const suggestedName =
    (url.searchParams.get("userName") ?? url.searchParams.get("displayName") ?? url.searchParams.get("name") ?? "").trim();
  const hostName =
    (url.searchParams.get("hostName") ?? url.searchParams.get("teacher") ?? url.searchParams.get("instructor") ?? "").trim();

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <title>ZoomClass 수업 참여 안내</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
        body {
            font-family: 'Noto Sans KR', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(160deg, #f5f7ff 0%, #dfe7ff 35%, #f1f5ff 100%);
            color: #1f2937;
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .card {
            width: min(520px, 92vw);
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(18px);
            border-radius: 24px;
            box-shadow: 0 24px 45px rgba(15, 23, 42, 0.18);
            padding: 36px 32px;
            display: flex;
            flex-direction: column;
            gap: 18px;
        }
        h1 {
            margin: 0;
            font-size: 24px;
            color: #1f2937;
        }
        p {
            margin: 0;
            line-height: 1.6;
        }
        .session-name {
            font-weight: 700;
            color: #364fc7;
        }
        code {
            background: rgba(15, 23, 42, 0.08);
            border-radius: 12px;
            padding: 12px;
            display: block;
            font-size: 14px;
            word-break: break-all;
        }
        .footer {
            font-size: 13px;
            color: #4b5563;
        }
        .steps {
            padding-left: 18px;
            margin: 0;
        }
        .steps li {
            margin: 4px 0;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>ZoomClass 수업 참여 안내</h1>
        <p><span class="session-name">${escapeHtml(topic || meetingNumber)}</span> 수업에 참여하려면 아래 순서를 따라주세요.</p>
        <p style="margin-top: 0; color: #475569;">회의 번호: <strong>${escapeHtml(meetingNumber)}</strong>${
          passcode ? ` • 회의 암호: <strong>${escapeHtml(passcode)}</strong>` : ""
        }${hostName ? `<br />담당 선생님: <strong>${escapeHtml(hostName)}</strong>` : ""}</p>
        <ol class="steps">
            <li>ZoomClass 애플리케이션을 실행합니다.</li>
            <li>로비 화면의 <strong>수업 참여</strong> 영역에 이 페이지의 링크를 붙여넣습니다.</li>
            <li>사용자 이름을 입력한 뒤 참여 버튼을 누르면 수업에 입장할 수 있습니다.</li>
        </ol>
        <p>참여 링크:</p>
        <code>${escapeHtml(joinUrl)}</code>
        <p class="footer">
            ${backendBase ? `이 링크는 <strong>${escapeHtml(backendBase)}</strong> 백엔드 서버를 사용합니다.<br />` : ""}
            ${suggestedName ? `추천 사용자 이름: <strong>${escapeHtml(suggestedName)}</strong><br />` : ""}
            링크가 작동하지 않는 경우 관리자에게 문의해 주세요.
        </p>
    </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: withCorsHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCorsHeaders({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    }),
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
  ensureMeetingSdkConfigured();

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

async function handleMeetingCreate(req: Request, url: URL, basePath: string) {
  const body = await req.json().catch(() => null);
  const rawTopic = typeof body?.topic === "string" ? body.topic : "";
  const rawHostName = typeof body?.hostName === "string" ? body.hostName : "";
  const topic = rawTopic.trim();
  const hostName = rawHostName.trim();
  const requestedStartDate = normalizeDateInput(body?.startTime);
  const requestedDuration = Number.isFinite(Number(body?.durationMinutes))
    ? Number(body?.durationMinutes)
    : undefined;

  if (!topic || !hostName) {
    return jsonResponse({ error: "topic and hostName are required." }, 400);
  }

  if (!SDK_KEY || !SDK_SECRET) {
    return jsonResponse(
      {
        error: "Zoom Meeting SDK credentials are not configured on the backend.",
        details: "Set ZOOM_SDK_KEY and ZOOM_SDK_SECRET environment variables.",
      },
      500,
    );
  }

  if (!isZoomApiAccessConfigured()) {
    return jsonResponse(
      {
        error: "Zoom API credentials are not configured on the backend.",
        details:
          "Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET for OAuth or ZOOM_API_KEY and ZOOM_API_SECRET for legacy JWT.",
      },
      400,
    );
  }

  try {
    const warnings: Array<{ type?: string; message: string; details?: string }> = [];

    let meetingData: Record<string, any> = {};
    let meetingNumber = "";
    let passcode = "";
    let joinUrl = "";
    let startUrl = "";
    let hostZak = "";
    let hostZakExpiresIn: number | null = null;
    let zakSource: string | null = null;
    let hostEmail = "";
    let hostDisplayName = "";
    let hostZoomUserId = "";

    try {
      const creation = await createZoomMeeting({
        topic,
        hostName,
        startTime: requestedStartDate ?? undefined,
        durationMinutes: requestedDuration,
      });

      meetingData = creation.meeting as Record<string, any>;
      meetingNumber = `${meetingData.id ?? meetingData.meeting_id ?? ""}`.trim();
      if (!meetingNumber) {
        throw new Error("Zoom 회의 생성 응답에 유효한 회의 ID가 없습니다.");
      }

      passcode =
        (typeof meetingData.password === "string" && meetingData.password) ||
        (typeof meetingData.passcode === "string" && meetingData.passcode) ||
        "";
      joinUrl = (typeof meetingData.join_url === "string" && meetingData.join_url) || "";
      startUrl = (typeof meetingData.start_url === "string" && meetingData.start_url) || "";
      hostZak = creation.zak || "";
      hostZakExpiresIn = creation.zakExpiresIn ?? null;
      zakSource = creation.zakSource ?? null;

      if (creation.hostProfile?.email) {
        hostEmail = creation.hostProfile.email;
        hostDisplayName = creation.hostProfile.displayName;
        hostZoomUserId = creation.hostProfile.id;
      } else {
        warnings.push({
          type: "zoom_host_identity",
          message: "Zoom 호스트 이메일을 가져오지 못했습니다. 호스트로 입장 시 오류가 발생할 수 있습니다.",
          details:
            "Zoom Server-to-Server OAuth 앱에 meeting:read:admin, user:read:admin 권한이 포함되어 있는지 확인해주세요.",
        });
      }
    } catch (meetingError) {
      const message = meetingError instanceof Error ? meetingError.message : String(meetingError);
      console.error("[token-server] Zoom API meeting creation failed.", meetingError);
      return jsonResponse(
        {
          error: "Failed to create Zoom meeting via Zoom API.",
          details: message,
        },
        502,
      );
    }

    let signature: string;
    try {
      signature = await generateMeetingSignature(meetingNumber, 1);
    } catch (signatureError) {
      const message = signatureError instanceof Error ? signatureError.message : String(signatureError);
      console.error("[token-server] Failed to generate meeting signature:", signatureError);
      return jsonResponse(
        {
          error: "Failed to generate meeting signature.",
          details: message,
        },
        500,
      );
    }

    const backendBase = buildBackendBase(url, basePath);
    const shareLink = buildJoinHelperUrl(url, basePath, {
      meetingNumber,
      passcode,
      topic,
      hostName,
      backendBase,
    });

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const client = ensureSupabaseClient();
      if (client) {
        const desiredStartTime =
          normalizeDateInput(meetingData.start_time) ?? requestedStartDate ?? new Date();

        const storageResult = await persistMeeting(client, {
          sessionName: topic,
          hostName,
          startTime: desiredStartTime,
          meetingNumber,
          joinUrl,
          startUrl,
          passcode,
        });

        if (!storageResult.success) {
          console.warn("[token-server] Failed to store meeting in Supabase:", storageResult.message);
          warnings.push({
            type: "supabase_storage",
            message: "Failed to record meeting in Supabase. Check backend configuration.",
            details:
              storageResult.reason === "invalid_input"
                ? "Invalid meeting payload provided to Supabase."
                : storageResult.message ?? "Unknown error while storing meeting.",
          });
        } else if (storageResult.warning === "missing_optional_columns") {
          warnings.push({
            type: "supabase_storage_columns",
            message: "Supabase meetings table is missing optional columns for Zoom metadata.",
            details: "Run the latest Supabase SQL migration to add metadata columns.",
          });
        }
      }
    }

    const responseBody: JsonRecord = {
      topic,
      hostName,
      meetingNumber,
      passcode,
      joinUrl,
      startUrl,
      sdkKey: SDK_KEY,
      signature,
      shareLink,
      isZoomOAuthMeeting: isZoomOAuthConfigured(),
      isZoomApiMeeting: isZoomApiAccessConfigured(),
      zak: hostZak,
      zakExpiresIn: hostZakExpiresIn,
      zakSource,
      hostEmail,
      hostDisplayName,
      hostZoomUserId,
      warnings,
    };

    if (body?.debugSignature || body?.includeSignatureDetails) {
      try {
        responseBody.signatureDetails = decodeMeetingSignature(signature);
      } catch (debugError) {
        responseBody.signatureDetailsError =
          debugError instanceof Error ? debugError.message : String(debugError);
      }
    }

    return jsonResponse(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[token-server] Failed to create Zoom meeting:", error);
    return jsonResponse({ error: "Failed to create Zoom meeting.", details: message }, 500);
  }
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

  const { basePath, relativePath } = resolvePathInfo(url);

  if (req.method === "OPTIONS") {
    const requestHeaders = req.headers.get("access-control-request-headers");
    const headers = withCorsHeaders(
      requestHeaders
        ? { "Access-Control-Allow-Headers": requestHeaders }
        : undefined,
    );
    return new Response(null, { status: 204, headers });
  }

  if (req.method === "GET" && relativePath === "/join") {
    try {
      return await renderJoinHelper(req, url, basePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500);
    }
  }

  if (req.method === "POST" && (relativePath === "/sign" || relativePath === "/meeting/signature")) {
    try {
      return await createMeetingSignature(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500);
    }
  }

  if (req.method === "GET" && relativePath === "/meetings") {
    return await listMeetings(req);
  }

  if (req.method === "POST" && relativePath === "/meetings") {
    return await createMeetingRecord(req);
  }

  if (req.method === "POST" && relativePath === "/meeting/create") {
    return await handleMeetingCreate(req, url, basePath);
  }

  return new Response("Not found", { status: 404, headers: withCorsHeaders() });
});
