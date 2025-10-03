// zoom-video-app/forge.config.js
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const {
  DEFAULT_BACKEND_FALLBACK,
  ensureHttpProtocol,
  getBackendOrigin,
} = require('./config/backend-url');
const { buildConnectSrcValues } = require('./config/connect-src');

const backendEnvUrl = ensureHttpProtocol(
  process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || DEFAULT_BACKEND_FALLBACK,
);

let backendOrigin = getBackendOrigin(backendEnvUrl);
if (!backendOrigin) {
  backendOrigin = backendEnvUrl;
}

const connectSrcValues = buildConnectSrcValues(backendOrigin);

const devContentSecurityPolicy = [
  "default-src 'self' 'unsafe-inline' data: blob:;",
  "img-src 'self' data: blob:;",
  "font-src 'self' https://fonts.gstatic.com data:;",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' data:;",
  `connect-src ${Array.from(connectSrcValues).join(' ')};`,
  "frame-src 'self' https://*.zoom.us https://*.zoomgov.com;",
  "media-src 'self' blob: data:;",
].join(' ');

module.exports = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          devContentSecurityPolicy,
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.jsx', // .js 에서 .jsx 로 변경
              name: 'main_window',
              preload: {
                js: './src/preload.js', // preload 스크립트 경로
                // name: 'main_window_preload' // preload 청크 이름 (선택적)
              },
            },
          ],
        },
      },
    },
    new FusesPlugin({ /* ...기존 설정 유지... */ }),
  ],
};
