const path = require('path');
const webpack = require('webpack');

// zoom-video-app 루트의 .env 파일 로드
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: './src/renderer.jsx', // 엔트리 파일이 renderer.jsx라고 가정
  target: 'electron-renderer', // 렌더러 프로세스에 대한 대상 명시적 설정
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
  },
  output: {
    path: path.resolve(__dirname, '.webpack/renderer'),
    filename: 'renderer.js', // index.html이 참조하는 출력 파일명
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.ZOOM_SDK_KEY': JSON.stringify(process.env.ZOOM_SDK_KEY),
      'process.env.ZOOM_SDK_SECRET': JSON.stringify(process.env.ZOOM_SDK_SECRET),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      // TOKEN_SERVER_URL은 IPC를 통해 가져오므로 여기에 반드시 필요하지는 않지만,
      // 빌드 시 렌더러에서 직접 필요하다면:
      // 'process.env.TOKEN_SERVER_URL': JSON.stringify(process.env.TOKEN_SERVER_URL)
    }),
  ],
};
