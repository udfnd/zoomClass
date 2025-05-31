// zoom-video-app/webpack.renderer.config.js
const path = require('path');
const webpack = require('webpack');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: './src/renderer.jsx',
  target: 'electron-renderer',
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: { presets: ['@babel/preset-env', '@babel/preset-react'] },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    fallback: {
      "assert": require.resolve("assert/"),
      "buffer": require.resolve("buffer/"),
      "constants": require.resolve("constants-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "domain": false,
      "events": require.resolve("events/"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "os": require.resolve("os-browserify/browser"),
      "path": require.resolve("path-browserify"),
      "punycode": false,
      "process": require.resolve("process/browser"),
      "querystring": false,
      "stream": require.resolve("stream-browserify"),
      "string_decoder": false,
      "sys": false,
      "timers": false,
      "tty": false,
      "url": false,
      "util": require.resolve("util/"),
      "vm": require.resolve("vm-browserify"),
      "zlib": false,
      "fs": false,
      "net": false,
      "tls": false,
      "child_process": false
    }
  },
  output: {
    path: path.resolve(__dirname, '.webpack/renderer'),
    filename: 'renderer.js',
    globalObject: 'self', // HMR을 위해 'self', 'this' 또는 'window'로 시도
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
    new webpack.DefinePlugin({
      'process.env.ZOOM_SDK_KEY': JSON.stringify(process.env.ZOOM_SDK_KEY),
      // 'process.env.ZOOM_SDK_SECRET': JSON.stringify(process.env.ZOOM_SDK_SECRET), // 렌더러에 불필요, 보안상 제거 권장
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    }),
  ],
};
