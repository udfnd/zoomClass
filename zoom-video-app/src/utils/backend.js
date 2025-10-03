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
