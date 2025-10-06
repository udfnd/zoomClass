// zoom-video-app/webpack.renderer.config.js
const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const SDK_VERSION = '3.11.0';
const sdkDistRoot = path.resolve(__dirname, 'node_modules/@zoom/meetingsdk/dist');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  devtool: process.env.NODE_ENV === 'development' ? 'eval-source-map' : 'source-map',
  entry: './src/renderer.jsx',
  target: 'web',
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
    alias: {
      'process/browser': require.resolve('process/browser'),
      process: require.resolve('process/browser'),
    },
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
    filename: 'index.js',
    chunkFilename: '[name].js',
    globalObject: 'window',
    publicPath: './',
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
    new webpack.DefinePlugin({
      'process.env.ZOOM_SDK_KEY': JSON.stringify(process.env.ZOOM_SDK_KEY),
      'process.env.ZOOM_SDK_SECRET': JSON.stringify(process.env.ZOOM_SDK_SECRET),
      'process.env.BACKEND_BASE_URL': JSON.stringify(process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || ''),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    }),
    new webpack.NormalModuleReplacementPlugin(
        /^events$/, // 'events' 모듈을 정확히 일치시킴
        require.resolve('events/') // 브라우저용 'events' 폴리필로 대체
    ),
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
        {
          from: path.join(sdkDistRoot, 'lib'),
          to: path.posix.join('main_window', 'zoomlib', SDK_VERSION, 'lib'),
          noErrorOnMissing: true,
        },
        {
          from: path.join(sdkDistRoot, 'css'),
          to: path.posix.join('main_window', 'zoomlib', SDK_VERSION, 'css'),
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
};
