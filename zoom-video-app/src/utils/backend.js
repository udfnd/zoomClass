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
