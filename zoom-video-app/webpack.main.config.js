const path = require('path');

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: './src/main.js',
  target: 'electron-main', // 메인 프로세스에 대한 대상 명시적 설정
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'] // 메인 프로세스에는 preset-react 불필요
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
