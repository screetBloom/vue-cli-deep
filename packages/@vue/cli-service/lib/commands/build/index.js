const defaults = {
  clean: true,
  target: 'app',
  formats: 'commonjs,umd,umd-min',
  'unsafe-inline': true
}

const buildModes = {
  lib: 'library',
  wc: 'web component',
  'wc-async': 'web component (async)'
}

// 多见于修改webpack配置
const modifyConfig = (config, fn) => {
  if (Array.isArray(config)) {
    config.forEach(c => fn(c))
  } else {
    fn(config)
  }
}

module.exports = (api, options) => {
  api.registerCommand('build', {
    description: 'build for production',
    usage: 'vue-cli-service build [options] [entry|pattern]',
    options: {
      '--mode': `specify env mode (default: production)`,
      '--dest': `specify output directory (default: ${options.outputDir})`,
      '--modern': `build app targeting modern browsers with auto fallback`,
      '--no-unsafe-inline': `build app without introducing inline scripts`,
      '--target': `app | lib | wc | wc-async (default: ${defaults.target})`,
      '--inline-vue': 'include the Vue module in the final bundle of library or web component target',
      '--formats': `list of output formats for library builds (default: ${defaults.formats})`,
      '--name': `name for lib or web-component mode (default: "name" in package.json or entry filename)`,
      '--filename': `file name for output, only usable for 'lib' target (default: value of --name)`,
      '--no-clean': `do not remove the dist directory before building the project`,
      '--report': `generate report.html to help analyze bundle content`,
      '--report-json': 'generate report.json to help analyze bundle content',
      '--skip-plugins': `comma-separated list of plugin names to skip for this run`,
      '--watch': `watch for changes`
    }
  }, async (args, rawArgs) => {
    for (const key in defaults) {
      if (args[key] == null) {
        args[key] = defaults[key]
      }
    }
    args.entry = args.entry || args._[0]
    // 非默认情况要挂载对应的入口
    if (args.target !== 'app') {
      args.entry = args.entry || 'src/App.vue'
    }

    // console.log('entry >', args.entry)
    process.env.VUE_CLI_BUILD_TARGET = args.target
    if (args.modern && args.target === 'app') {
      process.env.VUE_CLI_MODERN_MODE = true
      if (!process.env.VUE_CLI_MODERN_BUILD) {
        // main-process for legacy build
        await build(Object.assign({}, args, {
          modernBuild: false,
          keepAlive: true
        }), api, options)
        // spawn sub-process of self for modern build
        const { execa } = require('@vue/cli-shared-utils')
        const cliBin = require('path').resolve(__dirname, '../../../bin/vue-cli-service.js')
        await execa(cliBin, ['build', ...rawArgs], {
          stdio: 'inherit',
          env: {
            VUE_CLI_MODERN_BUILD: true
          }
        })
      } else {
        // sub-process for modern build
        await build(Object.assign({}, args, {
          modernBuild: true,
          clean: false
        }), api, options)
      }
      delete process.env.VUE_CLI_MODERN_MODE
    } else {
      if (args.modern) {
        const { warn } = require('@vue/cli-shared-utils')
        warn(
          `Modern mode only works with default target (app). ` +
          `For libraries or web components, use the browserslist ` +
          `config to specify target browsers.`
        )
      }
      await build(args, api, options)
    }
    delete process.env.VUE_CLI_BUILD_TARGET
  })
}

async function build (args, api, options) {
  const fs = require('fs-extra')
  const path = require('path')
  const webpack = require('webpack')
  const { chalk } = require('@vue/cli-shared-utils')
  const formatStats = require('./formatStats')
  const validateWebpackConfig = require('../../util/validateWebpackConfig')
  const {
    log,
    done,
    info,
    logWithSpinner,
    stopSpinner
  } = require('@vue/cli-shared-utils')

  log()
  const mode = api.service.mode
  console.log('\n ---------------- mode -------------------')
  // 应用模式构建
  if (args.target === 'app') {
    // 现代版本还是旧浏览器版本
    const bundleTag = args.modern
      ? args.modernBuild
        ? `modern bundle `
        : `legacy bundle `
      : ``
    logWithSpinner(`Building ${bundleTag}for ${mode}...`)
  } else {
    // 获取构建目标 lib || wc || wc-async
    const buildMode = buildModes[args.target]
    if (buildMode) {
      // 不同的构建版本 myLib.common.js，myLib.umd.js，myLib.umd.min.js
      const additionalParams = buildMode === 'library' ? ` (${args.formats})` : ``
      logWithSpinner(`Building for ${mode} as ${buildMode}${additionalParams}...`)
    } else {
      throw new Error(`Unknown build target: ${args.target}`)
    }
  }

  if (args.dest) {
    // Override outputDir before resolving webpack config as config relies on it (#2327)
    options.outputDir = args.dest
  }

  const targetDir = api.resolve(options.outputDir)
  const isLegacyBuild = args.target === 'app' && args.modern && !args.modernBuild

  // resolve raw webpack config
  let webpackConfig
  if (args.target === 'lib') {
    // 加载构建目标为 lib 的 webpack 配置
    webpackConfig = require('./resolveLibConfig')(api, args, options)
  } else if (
    args.target === 'wc' ||
    args.target === 'wc-async'
  ) {
    // 加载构建目标为 wc || wc-async 的 webpack 配置
    webpackConfig = require('./resolveWcConfig')(api, args, options)
  } else {
    // 默认的应用构建目标
    let strArr = []
    api.service.webpackChainFns.forEach(fn => {
      strArr.push(fn.toString())
    })
    // fs.writeFileSync(path.join(process.cwd(), './test/vue.js'), strArr, )
    // console.log('\n 执行到Vome了 \n', strArr)
    webpackConfig = require('./resolveAppConfig')(api, args, options)
  }

  console.log(`-------------- ${args.target} -------------------`)
  return;
  // check for common config errors
  validateWebpackConfig(webpackConfig, api, options, args.target)

  if (args.watch) {
    // 如果是 --watch模式，设置webpackConfig.wathc 为true
    modifyConfig(webpackConfig, config => {
      config.watch = true
    })
  }

  // 公开高级统计信息
  // 如果是 --dashboard模式，添加分析插件
  if (args.dashboard) {
    const DashboardPlugin = require('../../webpack/DashboardPlugin')
    modifyConfig(webpackConfig, config => {
      config.plugins.push(new DashboardPlugin({
        type: 'build',
        modernBuild: args.modernBuild,
        keepAlive: args.keepAlive
      }))
    })
  }

  // 如果是 --report模式，添加 webpack-bundle-analyzer 插件
  if (args.report || args['report-json']) {
    const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')
    modifyConfig(webpackConfig, config => {
      const bundleName = args.target !== 'app'
        ? config.output.filename.replace(/\.js$/, '-')
        : isLegacyBuild ? 'legacy-' : ''
      config.plugins.push(new BundleAnalyzerPlugin({
        logLevel: 'warn',
        openAnalyzer: false,
        analyzerMode: args.report ? 'static' : 'disabled',
        reportFilename: `${bundleName}report.html`,
        statsFilename: `${bundleName}report.json`,
        generateStatsFile: !!args['report-json']
      }))
    })
  }

  // 如果 --clean，则每次构建前清空构建文件夹
  if (args.clean) {
    await fs.remove(targetDir)
  }

  // console.log('webpackConfig ------------------------------->')
  // console.log(webpackConfig)
  // process.exit(1)
  // return;
  // return false;
  return new Promise((resolve, reject) => {
    webpack(webpackConfig, (err, stats) => {
      stopSpinner(false)
      if (err) {
        return reject(err)
      }

      if (stats.hasErrors()) {
        return reject(`Build failed with errors.`)
      }

      if (!args.silent) {
        const targetDirShort = path.relative(
          api.service.context,
          targetDir
        )
        log(formatStats(stats, targetDirShort, api))
        if (args.target === 'app' && !isLegacyBuild) {
          if (!args.watch) {
            done(`Build complete. The ${chalk.cyan(targetDirShort)} directory is ready to be deployed.`)
            info(`Check out deployment instructions at ${chalk.cyan(`https://cli.vuejs.org/guide/deployment.html`)}\n`)
          } else {
            done(`Build complete. Watching for changes...`)
          }
        }
      }

      // test-only signal
      if (process.env.VUE_CLI_TEST) {
        console.log('Build complete.')
      }

      resolve()
    })
  })
}

module.exports.defaultModes = {
  build: 'production'
}
