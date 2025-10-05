// zoom-video-app/webpack.renderer.config.js
const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const SDK_VERSION = '3.11.0';
const sdkDistRoot = path.resolve(__dirname, 'node_modules/@zoom/meetingsdk/dist');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  devtool: !isProd ? 'eval-source-map' : 'source-map',
  entry: './src/renderer.jsx',
  target: 'electron-renderer',
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: { loader: 'babel-loader', options: { presets: ['@babel/preset-env','@babel/preset-react'] } },
      },
      { test: /\.(png|jpe?g|gif|svg)$/i, type: 'asset/resource' },
      { test: /\.css$/i, use: ['style-loader','css-loader'] },
    ],
  },
  resolve: {
    extensions: ['.js','.jsx'],
    fallback: {
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
    },
  },
  output: isProd
      ? {
        path: path.resolve(__dirname, '.webpack/renderer/main_window'),
        filename: 'index.js',
        publicPath: './',         // file:// 에서 필수
        globalObject: 'window',
      }
      : {
        publicPath: '/',          // dev-server에서 안전
        globalObject: 'window',
      },
  plugins: [
    // Zoom SDK 자산을 HTML과 같은 폴더(=산출 루트)에 복사
    new CopyWebpackPlugin({
      patterns: [
        { from: path.join(sdkDistRoot, 'lib'), to: path.posix.join('zoomlib', SDK_VERSION, 'lib') },
        { from: path.join(sdkDistRoot, 'css'), to: path.posix.join('zoomlib', SDK_VERSION, 'css') },
      ],
    }),
  ],
};
