// zoom-video-app/webpack.renderer.config.js
/**
 * ✅ 목적
 * - Webpack 5에서 사라진 Node 코어 폴리필(events, buffer, stream, util)을 브라우저 타깃에 제공
 * - dev(webpack-dev-server)와 prod(file://)에서 모두 동작하도록 publicPath/출력 경로를 분기
 * - Zoom Meeting SDK 정적 자산(lib/css)을 HTML과 같은 폴더(또는 dev-server 루트)에 배치
 * - HMR에서 발생하던 "Uncaught ReferenceError: require is not defined" 제거
 *
 * ⚠️ 주의
 * - 여기서는 HtmlWebpackPlugin을 사용하지 않습니다 (forge의 plugin-webpack가 entryPoints로 HTML을 생성/주입)
 * - 'url/' 등 잘못된 폴리필 경로를 넣지 마세요. (이전 에러 원인)
 */

const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const SDK_VERSION = '3.11.0';
const sdkDistRoot = path.resolve(__dirname, 'node_modules/@zoom/meetingsdk/dist');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
    mode: process.env.NODE_ENV || 'development',
    devtool: isProd ? 'source-map' : 'eval-source-map',
    entry: './src/renderer.jsx',
    // 브라우저 렌더러 + HMR 환경에 맞춤
    target: 'electron-renderer',

    // ✅ Webpack 5: Node 코어 모듈 폴리필 수동 제공
    resolve: {
        fallback: {
            events: require.resolve('events/'),
            buffer: require.resolve('buffer/'),
            stream: require.resolve('stream-browserify'),
            util: require.resolve('util/'),
            // 필요 시: url: require.resolve('url')  (보통 불필요)
        },
        extensions: ['.js', '.jsx'],
    },

    module: {
        rules: [
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        // React 18 + 최신 문법
                        presets: ['@babel/preset-env', '@babel/preset-react'],
                    },
                },
            },
            { test: /\.(png|jpe?g|gif|svg)$/i, type: 'asset/resource' },
            { test: /\.css$/i, use: ['style-loader', 'css-loader'] },
        ],
    },

    plugins: [
        // ✅ 브라우저에서 Buffer / process 전역 사용 가능하게
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: 'process/browser',
        }),

        // ✅ Zoom SDK 정적 자산 복사
        // dev: http://localhost:<port>/zoomlib/3.11.0/{lib,css}
        // prod: file://.../.webpack/renderer/main_window/zoomlib/3.11.0/{lib,css}
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.join(sdkDistRoot, 'lib'),
                    to: path.posix.join('zoomlib', SDK_VERSION, 'lib'),
                    noErrorOnMissing: true,
                },
                {
                    from: path.join(sdkDistRoot, 'css'),
                    to: path.posix.join('zoomlib', SDK_VERSION, 'css'),
                    noErrorOnMissing: true,
                },
            ],
        }),
    ],

    /**
     * ⬇ dev와 prod를 다르게:
     * - dev: dev-server가 메모리FS에서 서빙하므로 output.path/filename 강제 X (publicPath는 '/')
     * - prod: index.html과 같은 폴더(.webpack/renderer/main_window)에 index.js 기록 + 상대 publicPath('./')
     */
    output: isProd
        ? {
            path: path.resolve(__dirname, '.webpack/renderer/main_window'),
            filename: 'index.js',
            publicPath: './',       // file://에서 상대 경로 필수
            globalObject: 'window', // 안전
        }
        : {
            publicPath: '/',        // dev-server 루트
            globalObject: 'window',
        },
};
