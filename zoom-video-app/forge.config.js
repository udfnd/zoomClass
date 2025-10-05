// zoom-video-app/forge.config.js
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const {
  DEFAULT_BACKEND_FALLBACK,
  ensureHttpProtocol,
  getBackendOrigin,
} = require('./config/backend-url');
const { buildConnectSrcValues } = require('./config/connect-src');
const { buildCspString } = require('./config/csp');

const backendEnvUrl = ensureHttpProtocol(
  process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || DEFAULT_BACKEND_FALLBACK,
);

let backendOrigin = getBackendOrigin(backendEnvUrl);
if (!backendOrigin) {
  backendOrigin = backendEnvUrl;
}

const connectSrcValues = buildConnectSrcValues(backendOrigin);

const devContentSecurityPolicy = buildCspString({
  connectSrc: Array.from(connectSrcValues),
});

const makers = [
  {
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'zoom-video-app',
      authors: 'Your Company',
      setupExe: 'ZoomClassSetup.exe',
      noMsi: true,
      shortcutFolderName: 'Zoom Class',
    },
    platforms: ['win32'],
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
];

module.exports = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers,
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
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
