const DEFAULT_ZOOM_SDK_DOMAIN = 'https://localhost';

const HEADER_SUFFIX = '/';

function sanitizeDomain(value) {
  if (!value) {
    return '';
  }

  const trimmed = `${value}`.trim();
  if (!trimmed) {
    return '';
  }

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(normalized);
    if (!/^https?:$/i.test(url.protocol)) {
      return '';
    }
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    console.warn('[zoom-sdk] Ignoring invalid allowed domain value:', value, error);
    return '';
  }
}

function resolveZoomSdkDomain() {
  const envValue =
    process.env.ZOOM_SDK_ALLOWED_DOMAIN ||
    process.env.ZOOM_SDK_DOMAIN ||
    process.env.ZOOM_MEETING_SDK_DOMAIN ||
    '';

  const sanitized = sanitizeDomain(envValue);
  if (sanitized) {
    return sanitized;
  }

  return DEFAULT_ZOOM_SDK_DOMAIN;
}

function buildZoomSdkHeaderValues() {
  const origin = resolveZoomSdkDomain();
  const referer = `${origin.replace(/\/+$/, '')}${HEADER_SUFFIX}`;
  return { origin, referer };
}

module.exports = {
  DEFAULT_ZOOM_SDK_DOMAIN,
  buildZoomSdkHeaderValues,
  resolveZoomSdkDomain,
};
