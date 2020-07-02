module.exports = (api, args, options) => {
  console.log('也执行到我了 ～')
  const config = api.resolveChainableWebpackConfig()
  console.log('3 ～')
  const targetDir = api.resolve(args.dest || options.outputDir)
  console.log('4 ～')

  // respect inline build destination in copy plugin
  if (args.dest && config.plugins.has('copy')) {
    config.plugin('copy').tap(pluginArgs => {
      pluginArgs[0][0].to = targetDir
      return pluginArgs
    })
  }

  if (args.modern) {
    const ModernModePlugin = require('../../webpack/ModernModePlugin')
    if (!args.modernBuild) {
      // Inject plugin to extract build stats and write to disk
      config
        .plugin('modern-mode-legacy')
        .use(ModernModePlugin, [{
          targetDir,
          isModernBuild: false,
          unsafeInline: args['unsafe-inline']
        }])
    } else {
      // Inject plugin to read non-modern build stats and inject HTML
      config
        .plugin('modern-mode-modern')
        .use(ModernModePlugin, [{
          targetDir,
          isModernBuild: true,
          unsafeInline: args['unsafe-inline'],
          // as we may generate an addition file asset (if `no-unsafe-inline` specified)
          // we need to provide the correct directory for that file to place in
          jsDirectory: require('../../util/getAssetPath')(options, 'js')
        }])
    }
  }

  console.log(' --------------------- resolveAppConfig start ------------------------ ')
  console.log(args.dest, args.modern)
  // console.log(config)
  console.log(' --------------------- resolveAppConfig end ------------------------ ')
  const rawConfig = api.resolveWebpackConfig(config)

  // respect inline entry
  if (args.entry && !options.pages) {
    rawConfig.entry = { app: api.resolve(args.entry) }
  }

  return rawConfig
}
