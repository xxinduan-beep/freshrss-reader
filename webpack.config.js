const HtmlWebpackPlugin = require("html-webpack-plugin")
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin")
const { GriffelPlugin } = require("@griffel/webpack-plugin")
const MiniCssExtractPlugin = require("mini-css-extract-plugin")

// Renderer bundle only. The desktop shell is now the Go/Wails app in main.go
// (build with ./build.sh, run with ./run.sh).
module.exports = {
    mode: "production",
    entry: "./src/index.tsx",
    target: "web",
    devtool: "source-map",
    performance: {
        hints: false,
    },
    module: {
        rules: [
            {
                test: /\.(js|ts|tsx)$/,
                include: [/src/, /node_modules\/@fluentui/],
                use: {
                    loader: "@griffel/webpack-plugin/loader",
                },
            },
            {
                test: /\.ts(x?)$/,
                include: /src/,
                resolve: {
                    extensions: [".ts", ".tsx", ".js"],
                },
                use: {
                    loader: "ts-loader",
                },
            },
            {
                test: /\.css$/,
                use: [MiniCssExtractPlugin.loader, "css-loader"],
            },
        ],
    },
    output: {
        path: __dirname + "/dist",
        filename: "index.js",
    },
    plugins: [
        new NodePolyfillPlugin({
            additionalAliases: ["process"],
        }),
        new HtmlWebpackPlugin({
            template: "./src/index.html",
        }),
        new MiniCssExtractPlugin(),
        new GriffelPlugin(),
    ],
}
