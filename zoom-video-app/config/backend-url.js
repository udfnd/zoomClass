const DEFAULT_BACKEND_FALLBACK = '';

const ensureHttpProtocol = (value) => {
  if (!value) {
    return '';
  }

  const trimmed = `${value}`.trim();
  if (!trimmed) {
    return '';
  }

  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return trimmed;
};

const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');

const normalizeBackendUrl = (input) => {
  const ensured = ensureHttpProtocol(input);
  if (!ensured) {
    return '';
  }

  try {
    const url = new URL(ensured);
    url.hash = '';
    url.search = '';
    return stripTrailingSlashes(url.toString());
  } catch (error) {
    return stripTrailingSlashes(ensured);
  }
};

const getBackendOrigin = (value) => {
  const ensured = ensureHttpProtocol(value);
  if (!ensured) {
    return '';
  }

  try {
    return new URL(ensured).origin;
  } catch (error) {
    return '';
  }
};

module.exports = {
  DEFAULT_BACKEND_FALLBACK,
  ensureHttpProtocol,
  normalizeBackendUrl,
  getBackendOrigin,
};
