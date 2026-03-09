module.exports = {
  publicPath: process.env.NODE_ENV === 'production' ? '/' : '/',
  outputDir: 'dist',
  devServer: {
    port: 8082,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true
      }
    }
  },
  chainWebpack: config => {
    config.module
      .rule('js')
      .include
        .add(/node_modules[\\/]@azure[\\/]msal-browser/)
        .add(/node_modules[\\/]@azure[\\/]msal-common/)
        .end()
      .use('babel-loader')
        .loader('babel-loader')
        .tap(options => {
          // 保持原有配置
          return options
        })
  }
}