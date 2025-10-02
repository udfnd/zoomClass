// zoom-video-app/forge.config.js
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const backendEnvUrl = process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || 'http://localhost:4000';
let backendOrigin = '';
try {
  backendOrigin = new URL(backendEnvUrl).origin;
} catch (error) {
  backendOrigin = backendEnvUrl;
}

const connectSrcValues = new Set([
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
]);

if (backendOrigin) {
  connectSrcValues.add(backendOrigin);
}

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
