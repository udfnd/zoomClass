// zoom-video-app/webpack.main.config.js (수정된 전체 파일)
const path = require('path');
const webpack = require('webpack');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const rawBackendUrl = process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || '';
const rawTokenServerUrl = process.env.TOKEN_SERVER_URL || '';

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: './src/main.js',
  target: 'electron-main',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.js'],
  },
  output: {
    path: path.resolve(__dirname, '.webpack/main'),
    filename: 'index.js',
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.BACKEND_BASE_URL': JSON.stringify(rawBackendUrl),
      'process.env.TOKEN_SERVER_URL': JSON.stringify(rawTokenServerUrl),
      'process.env.DEFAULT_BACKEND_FALLBACK': JSON.stringify(rawBackendUrl),
    }),
  ],
};
