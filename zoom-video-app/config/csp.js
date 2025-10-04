const ZOOM_STATIC_HOSTS = [
  'https://source.zoom.us',
  'https://zoom.us',
  'https://*.zoom.us',
  'https://*.zoomgov.com',
  'https://*.zoomus.cn',
  'https://dmogdx0jrul3u.cloudfront.net',
];

const ZOOM_FRAME_HOSTS = [
  'https://zoom.us',
  'https://*.zoom.us',
  'https://*.zoomgov.com',
  'https://*.zoomus.cn',
];

const FONT_HOSTS = ['https://fonts.gstatic.com'];
const STYLE_HOSTS = ['https://fonts.googleapis.com'];
const CONNECT_PROTOCOL_FALLBACKS = ['http:', 'https:', 'ws:', 'wss:'];

const uniqueTokens = (values = []) =>
  Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0)));

const buildCspDirectives = ({ connectSrc = [] } = {}) => {
  const normalizedConnect = Array.isArray(connectSrc) ? connectSrc : Array.from(connectSrc);

  return {
    'default-src': uniqueTokens(["'self'", "'unsafe-inline'", 'data:', 'blob:', ...ZOOM_STATIC_HOSTS]),
    'script-src': uniqueTokens([
      "'self'",
      "'unsafe-eval'",
      "'unsafe-inline'",
      'data:',
      'blob:',
      ...ZOOM_STATIC_HOSTS,
    ]),
    'script-src-elem': uniqueTokens([
      "'self'",
      "'unsafe-eval'",
      "'unsafe-inline'",
      'data:',
      'blob:',
      ...ZOOM_STATIC_HOSTS,
    ]),
    'style-src': uniqueTokens(["'self'", "'unsafe-inline'", ...STYLE_HOSTS, ...ZOOM_STATIC_HOSTS]),
    'style-src-elem': uniqueTokens(["'self'", "'unsafe-inline'", ...STYLE_HOSTS, ...ZOOM_STATIC_HOSTS]),
    'img-src': uniqueTokens(["'self'", 'data:', 'blob:', ...ZOOM_STATIC_HOSTS]),
    'font-src': uniqueTokens(["'self'", 'data:', ...FONT_HOSTS, ...ZOOM_STATIC_HOSTS]),
    'frame-src': uniqueTokens(["'self'", ...ZOOM_FRAME_HOSTS]),
    'media-src': uniqueTokens(["'self'", 'blob:', 'data:']),
    'connect-src': uniqueTokens([
      ...normalizedConnect,
      ...CONNECT_PROTOCOL_FALLBACKS,
    ]),
  };
};

const serializeCsp = (directives = {}) =>
  Object.entries(directives)
    .filter(([, tokens]) => tokens && tokens.length)
    .map(([directive, tokens]) => `${directive} ${tokens.join(' ')}`)
    .join('; ');

const buildCspString = ({ connectSrc = [] } = {}) => serializeCsp(buildCspDirectives({ connectSrc }));

module.exports = {
  ZOOM_STATIC_HOSTS,
  ZOOM_FRAME_HOSTS,
  FONT_HOSTS,
  STYLE_HOSTS,
  CONNECT_PROTOCOL_FALLBACKS,
  uniqueTokens,
  buildCspDirectives,
  serializeCsp,
  buildCspString,
};
