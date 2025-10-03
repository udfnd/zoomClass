const CONNECT_SRC_BASE = [
  "'self'",
  'data:',
  'blob:',
  'ws://localhost:*',
  'wss://localhost:*',
  'http://localhost:*',
  'https://localhost:*',
  'https://zoom.us',
  'https://*.zoom.us',
  'https://source.zoom.us',
  'https://api.zoom.us',
  'https://marketplace.zoom.us',
  'https://*.zoomgov.com',
  'https://zoomgov.com',
  'wss://*.zoom.us',
  'wss://*.zoomgov.com',
  'https://*.zoomus.cn',
  'wss://*.zoomus.cn',
];

const buildConnectSrcValues = (...extraSources) => {
  const values = new Set(CONNECT_SRC_BASE);
  extraSources.filter(Boolean).forEach((source) => {
    values.add(source);
  });
  return values;
};

module.exports = {
  CONNECT_SRC_BASE,
  buildConnectSrcValues,
};
