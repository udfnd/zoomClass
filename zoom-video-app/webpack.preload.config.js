// zoom-video-app/webpack.preload.config.js
const path = require('path');

module.exports = {
    target: 'electron-preload',

    // ▶ 프리로드 진입점 파일
    entry: path.resolve(__dirname, 'src/preload.js'),

    output: {
        filename: 'preload.js',
        path: path.resolve(__dirname, '.webpack/preload'),
        library: {
            type: 'commonjs2', // Electron이 require() 할 때 commonjs 모듈로 해석
        }
    },

    module: {
        rules: [
            {
                test: /\.jsx?$/,      // 만약 preload.js에 JSX나 ESNext 문법이 있으면 이 설정만으로 충분
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            // Node.js 최신 문법을 트랜스파일링 (Electron preload는 Node 환경이므로 node:current)
                            ['@babel/preset-env', { targets: { node: 'current' } }]
                        ]
                    }
                }
            }
        ]
    },

    resolve: {
        extensions: ['.js', '.jsx', '.json'],
        alias: {
            'node:fs': 'fs',
            'node:path': 'path',
            'node:os': 'os',
            'node:crypto': 'crypto',
            'node:assert': 'assert',
            'node:util': 'util',
            'node:process': 'process'
        },
        fallback: {
            fs: false,
            path: false,
            os: false,
            crypto: false,
            assert: false,
            util: false,
            process: false
        }
    },

    externals: {
        fs: 'commonjs fs',
        path: 'commonjs path',
        os: 'commonjs os',
        crypto: 'commonjs crypto',
        assert: 'commonjs assert',
        util: 'commonjs util',
        process: 'commonjs process'
    }
};
