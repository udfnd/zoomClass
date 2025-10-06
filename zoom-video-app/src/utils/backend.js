const SUPABASE_ANON_KEY =
    (process.env.SUPABASE_FUNCTION_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const SUPABASE_HOST_PATTERN = /\.supabase\.[a-z]+$/i;
const SUPABASE_AUTH_HELP_MESSAGE =
    'Supabase Functions 백엔드를 호출하려면 환경 변수 SUPABASE_FUNCTION_ANON_KEY 또는 SUPABASE_ANON_KEY에 anon 키를 설정해야 합니다. Supabase Project Settings → API에서 anon public 키를 확인할 수 있습니다.';

const isHeadersInstance = (value) => typeof Headers !== 'undefined' && value instanceof Headers;

export const normalizeBackendUrl = (input) => {
    if (!input) {
        return '';
    }

    const trimmed = `${input}`.trim();
    if (!trimmed) {
        return '';
    }

    let candidate = trimmed;
    if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate)) {
        candidate = `http://${candidate}`;
    }

    try {
        const url = new URL(candidate);
        // Clear any hash/search fragments that are not relevant for the base URL
        url.hash = '';
        url.search = '';
        const normalized = url.toString().replace(/\/+$/, '');
        return normalized;
    } catch (error) {
        return candidate.replace(/\/+$/, '');
    }
};

export const getBackendLabel = (url) => {
    const normalized = normalizeBackendUrl(url);
    if (!normalized) {
        return '';
    }

    try {
        const { hostname, port } = new URL(normalized);
        return port ? `${hostname}:${port}` : hostname;
    } catch (error) {
        return normalized.replace(/^https?:\/\//, '');
    }
};

export const parseJoinLink = (input) => {
    if (!input) {
        return null;
    }

    const trimmed = `${input}`.trim();
    if (!trimmed) {
        return null;
    }

    let url;
    try {
        url = new URL(trimmed);
    } catch (error) {
        return null;
    }

    const meetingNumber =
        url.searchParams.get('meetingNumber') ||
        url.searchParams.get('mn') ||
        url.searchParams.get('meeting') ||
        url.searchParams.get('sessionNumber');

    const passcode =
        url.searchParams.get('passcode') ||
        url.searchParams.get('pwd') ||
        url.searchParams.get('password');

    const topicParam =
        url.searchParams.get('topic') || url.searchParams.get('sessionName') || url.searchParams.get('session');

    if (!meetingNumber) {
        return null;
    }

    const explicitBackendParam = url.searchParams.get('backendUrl') || url.searchParams.get('backend');

    let backendUrl = normalizeBackendUrl(explicitBackendParam);

    if (!backendUrl) {
        const pathnameWithoutTrailingSlash = url.pathname.replace(/\/+$/, '');
        const basePath = pathnameWithoutTrailingSlash.replace(/\/join$/, '');
        backendUrl = normalizeBackendUrl(`${url.origin}${basePath}`);
    }

    const displayName =
        url.searchParams.get('userName') ||
        url.searchParams.get('displayName') ||
        url.searchParams.get('name') ||
        '';

    const hostName =
        url.searchParams.get('hostName') ||
        url.searchParams.get('teacher') ||
        url.searchParams.get('instructor') ||
        '';

    return {
        sessionName: topicParam || '',
        topic: topicParam || '',
        meetingNumber,
        passcode: passcode || '',
        backendUrl,
        joinUrl: url.toString(),
        displayName,
        hostName,
    };
};

const isSupabaseHostname = (hostname = '') => SUPABASE_HOST_PATTERN.test(hostname);

export const isSupabaseEdgeFunctionUrl = (input) => {
    const normalized = normalizeBackendUrl(input);
    if (!normalized) {
        return false;
    }

    try {
        const { hostname, pathname } = new URL(normalized);
        if (!isSupabaseHostname(hostname)) {
            return false;
        }

        return /\/functions\/(v1|v[\d]+)\//.test(pathname);
    } catch (error) {
        return false;
    }
};

const mergeHeaders = (baseHeaders = {}, overrideHeaders = {}) => {
    const normalizedEntries = (headers) => {
        if (!headers) {
            return [];
        }

        if (isHeadersInstance(headers)) {
            return Array.from(headers.entries());
        }

        if (Array.isArray(headers)) {
            return headers.filter((entry) => Array.isArray(entry) && entry[0]);
        }

        if (typeof headers === 'object') {
            return Object.entries(headers);
        }

        return [];
    };

    const map = new Map();

    normalizedEntries(baseHeaders).forEach(([key, value]) => {
        map.set(key, value);
    });

    normalizedEntries(overrideHeaders).forEach(([key, value]) => {
        map.set(key, value);
    });

    return Object.fromEntries(map.entries());
};

export const getBackendAuthHeaders = (backendUrl) => {
    if (!backendUrl) {
        return {};
    }

    if (!SUPABASE_ANON_KEY) {
        return {};
    }

    if (!isSupabaseEdgeFunctionUrl(backendUrl)) {
        return {};
    }

    return {
        // Supabase Edge Functions require an Authorization header and an apikey header.
        // https://supabase.com/docs/guides/functions#invoking-edge-functions
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
    };
};

export const withBackendAuthHeaders = (backendUrl, headers = {}) => {
    const authHeaders = getBackendAuthHeaders(backendUrl);
    if (!authHeaders || Object.keys(authHeaders).length === 0) {
        if (isHeadersInstance(headers)) {
            return new Headers(headers);
        }

        if (Array.isArray(headers)) {
            return headers.slice();
        }

        if (headers && typeof headers === 'object') {
            return { ...headers };
        }

        return {};
    }

    if (isHeadersInstance(headers)) {
        const merged = new Headers(authHeaders);
        headers.forEach((value, key) => {
            merged.set(key, value);
        });
        return merged;
    }

    if (Array.isArray(headers)) {
        return Object.entries(mergeHeaders(authHeaders, Object.fromEntries(headers)));
    }

    if (headers && typeof headers === 'object') {
        return mergeHeaders(authHeaders, headers);
    }

    return { ...authHeaders };
};

export const hasSupabaseAnonKeyConfigured = () => Boolean(SUPABASE_ANON_KEY);

export const getSupabaseAuthHelpMessage = () => SUPABASE_AUTH_HELP_MESSAGE;

export const ensureBackendAuthConfigured = (backendUrl) => {
    if (isSupabaseEdgeFunctionUrl(backendUrl) && !hasSupabaseAnonKeyConfigured()) {
        throw new Error(SUPABASE_AUTH_HELP_MESSAGE);
    }
};
