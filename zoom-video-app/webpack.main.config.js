const path = require('path');

module.exports = {
  entry: './src/main.js',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.js']
  },
  output: {
    path: path.resolve(__dirname, '.webpack/main'),
    filename: 'index.js'
  }
};
