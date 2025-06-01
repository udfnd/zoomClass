// zoom-video-app/webpack.main.config.js
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
  externals: {
    'electron-store': 'commonjs electron-store',
  },
};
