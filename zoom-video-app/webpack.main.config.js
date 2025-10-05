// zoom-video-app/webpack.main.config.js (수정된 전체 파일)
const path = require('path');

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
};
