/**
 * 真机端到端：在一台没装过任何东西的 Mac 上，只靠安装包能不能用
 *   ① 打包（prepack 编出通用程序），包里带着 bin/dsh-cu 和 bin/dsh-cursor-overlay，可执行、签过名、两种芯片都有
 *   ② 装进全新的 DSH（dsh plugin add），起网页版；设置页报「命令行工具已装好 · 插件自带」
 *   ③ 装好的那份程序能跑：协议号对得上；有 Rosetta 的话 Intel 那一半也跑一下
 *   ④ 插件自己的 desktop_windows 工具走自带的程序列出窗口
 *
 *   node e2e/e2e-dsh.mjs [--dsh latest|next|<版本>]
 * HOME、DSH_HOME 都是临时的：没有 ~/.dsh/bin，证明不靠 install.sh。不是 macOS 就跳过。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DSH_SPEC = argv.includes('--dsh') ? argv[argv.indexOf('--dsh') + 1] : 'latest'
const REGISTRY = 'https://registry.npmjs.org/'
const OS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'package.json'), 'utf8'))
const ENGINE_PROTOCOL = '2'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const summary = (title, lines) => {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${title}\n\n${lines.join('\n')}\n\n`)
}
if (process.platform !== 'darwin') {
  console.log(`只支持 macOS，${OS} 上跳过`)
  summary(`Mac 桌面真机测试 · ${OS}`, ['- ⏭ 只支持 macOS，跳过'])
  process.exit(0)
}

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dcu-e2e-')))
const HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME, { recursive: true })
process.env.HOME = HOME
process.env.DSH_CU_CONFIG = path.join(tmp, 'config.json')
delete process.env.DSH_CU_BIN
delete process.env.DSH_CU_OVERLAY
fs.writeFileSync(process.env.DSH_CU_CONFIG, '{"showCursor":false}\n')
const env = { ...process.env, DSH_HOME: path.join(tmp, 'dsh-home'), npm_config_registry: REGISTRY }
env.PATH = `${path.join(tmp, 'cli', 'node_modules', '.bin')}${path.delimiter}${env.PATH}`
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 << 20, ...opts })
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() }
}

const results = []
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra: cond ? '' : String(extra) })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${extra}`}`)
  return !!cond
}
const failed = () => results.filter((r) => !r.ok)

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 15000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')) })
  })
}

/** DSH 装好的插件目录里那份程序（DSH_HOME 下的 node_modules，按真实路径去重） */
function installedBins(dir, out = new Set(), depth = 0) {
  if (depth > 12) return out
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.name === 'dsh-cu' && path.basename(dir) === 'bin' && fs.existsSync(path.join(dir, '..', 'setup.js'))) out.add(fs.realpathSync(p))
    else if (e.isDirectory() || e.isSymbolicLink()) { try { if (fs.statSync(p).isDirectory()) installedBins(p, out, depth + 1) } catch {} }
  }
  return out
}

let web = null
let webLog = ''
let dshVersion = DSH_SPEC

try {
  // ① 打包：prepack 编出自带程序
  fs.mkdirSync(path.join(tmp, 'cli'), { recursive: true })
  const pack = run('npm', ['pack', '--pack-destination', tmp], { cwd: path.join(ROOT, 'plugin') })
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))
  if (!check('打包（顺带编好自带程序）', pack.code === 0 && tgz, pack.out.slice(-1500))) throw new Error('打包失败')
  const listing = run('tar', ['-tvzf', path.join(tmp, tgz)]).out
  for (const name of ['dsh-cu', 'dsh-cursor-overlay']) {
    const line = listing.split('\n').find((l) => l.endsWith(`package/bin/${name}`)) || ''
    check(`安装包里带着 ${name}，可执行`, /^-rwxr-xr-x/.test(line), line || '没有')
  }

  // ② 装进全新的 DSH
  fs.writeFileSync(path.join(tmp, 'cli', 'package.json'), '{"private":true}')
  const inst = run('npm', ['i', `@deepseek-ai/dsh@${DSH_SPEC}`, 'pnpm@11', `--registry=${REGISTRY}`, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: path.join(tmp, 'cli') })
  if (!check(`装 DSH ${DSH_SPEC}`, inst.code === 0, inst.out.slice(-1500))) throw new Error('DSH 没装上')
  const cliDir = path.join(tmp, 'cli', 'node_modules', '@deepseek-ai', 'dsh')
  dshVersion = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')).version
  console.log(`  DSH ${dshVersion}`)
  const add = run(process.execPath, [path.join(cliDir, 'lib', 'bin.js'), 'plugin', '--profile', 'web', 'add', path.join(tmp, tgz)], { cwd: tmp })
  if (!check('DSH 装上插件', add.code === 0, add.out.slice(-1500))) throw new Error('插件没装上')
  check('没有 ~/.dsh/bin（不靠 install.sh）', !fs.existsSync(path.join(HOME, '.dsh', 'bin', 'dsh-cu')))

  const url = await new Promise((resolve) => {
    web = spawn(process.execPath, [path.join(cliDir, 'lib', 'bin.js'), 'web', '--no-open', '--port', '0', '--host', '127.0.0.1'], { env, cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] })
    const on = (d) => { webLog = (webLog + d).slice(-50000); const m = /dsh web: (http:\/\/\S+)/.exec(webLog); if (m) resolve(m[1]) }
    web.stdout.on('data', on)
    web.stderr.on('data', on)
    web.on('exit', () => resolve(null))
    setTimeout(() => resolve(null), 180_000)
  })
  if (!check('DSH 网页版起来了', url, webLog.slice(-2000))) throw new Error('网页版没起来')

  let st = null
  let last = ''
  for (let i = 0; i < 60 && !st; i++) {
    try {
      const r = await get(`${new URL(url).origin}/dsh-mac-computer-use/panel`)
      last = `HTTP ${r.status} ${r.text.slice(0, 200)}`
      if (r.status === 200) st = JSON.parse(r.text)
    } catch (e) { last = e.message }
    if (!st) await sleep(1000)
  }
  if (!check('设置页接口能用', st, last)) throw new Error('设置页没数据')
  check('设置页报的插件版本对', st.plugin === PKG.version, st.plugin)
  check('设置页：命令行工具已装好 · 插件自带', st.bin && st.bin.source === 'bundled' && !st.bin.outdated, JSON.stringify(st.bin))
  check('设置页：光标浮层在', st.overlay && st.overlay.installed, JSON.stringify(st.overlay))

  // ③ 装好的那份程序
  const bins = [...installedBins(path.join(tmp, 'dsh-home'))]
  if (!check('DSH 装好的插件里有自带程序', bins.length > 0, '没找到')) throw new Error('没找到装好的程序')
  const bin = bins[0]
  check('协议号对得上', run(bin, ['version']).out === ENGINE_PROTOCOL, run(bin, ['version']).out)
  const archs = run('lipo', ['-archs', bin]).out
  check('Apple 芯片和 Intel 都有', /arm64/.test(archs) && /x86_64/.test(archs), archs)
  check('签过名（Apple 芯片只跑签名的程序）', run('codesign', ['-v', bin]).code === 0, run('codesign', ['-v', bin]).out)
  const minos = (/minos (\S+)/.exec(run('vtool', ['-show-build', bin]).out) || [])[1]
  check('最低支持 macOS 11', minos === '11.0', minos)
  if (run('arch', ['-x86_64', '/usr/bin/true']).code === 0) {
    check('Intel 那一半也能跑（Rosetta）', run('arch', ['-x86_64', bin, 'version']).out === ENGINE_PROTOCOL)
  } else {
    console.log('  （这台没有 Rosetta，Intel 那一半不跑）')
  }

  // ④ 插件自己的工具
  const plugin = await import(pathToFileURL(path.join(path.dirname(path.dirname(bin)), 'index.js')))
  const tools = new Map()
  plugin.apply({ tools: { register: (t) => tools.set(t.name, t) }, get() {}, inject() {} }, {})
  check('注册了 desktop_* 工具', tools.size >= 10 && tools.has('desktop_windows'), [...tools.keys()].join(','))
  const r = await tools.get('desktop_windows').execute({}, {})
  check('desktop_windows 用自带程序列出窗口', /pid=\d+ win=\d+/.test(String(r.text)) || r.text === '(没有匹配的窗口)', String(r.text).slice(0, 300))
} catch (e) {
  check('没有异常', false, (e && e.stack) || e)
} finally {
  if (failed().length) console.log(`\n── DSH 网页版日志 ──\n${webLog.split('\n').slice(-30).join('\n')}`)
  if (web && web.exitCode === null) web.kill('SIGTERM')
  await sleep(1500)
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  summary(`Mac 桌面真机测试 · ${OS} · DSH ${dshVersion}`, results.map((x) => `- ${x.ok ? '✅' : '❌'} ${x.name}${x.ok ? '' : `：${x.extra.split('\n')[0]}`}`))
  console.log(failed().length ? `\n❌ ${failed().length} 项没过` : '\n✅ 全部通过')
  process.exit(failed().length ? 1 : 0)
}
