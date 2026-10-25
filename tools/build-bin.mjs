#!/usr/bin/env node
/**
 * 打包前（npm pack 的 prepack）把引擎 dsh-cu 和光标浮层编成通用程序（Apple 芯片 + Intel，macOS 11 起），
 * 放进 plugin/bin/：插件装上就能用，不用再 clone 仓库、装 Xcode 编译。
 *
 * 不是 macOS、或没有 swiftc：跳过（插件找不到自带的就退回 ~/.dsh/bin）。
 * 但在 CI 的 Mac 上必须编出来，编不出就让打包失败，免得发出去一个用不了的包。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'plugin', 'bin')
const MIN_MACOS = '11.0'
const ARCHS = ['arm64', 'x86_64']
const TARGETS = [
  { name: 'dsh-cu', src: 'tools/dsh-cu.swift', frameworks: ['AppKit', 'ApplicationServices', 'Vision'] },
  { name: 'dsh-cursor-overlay', src: 'cursor/cursor-overlay.swift', frameworks: ['AppKit', 'QuartzCore'] },
]

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
const has = (cmd) => { try { run('/usr/bin/which', [cmd]); return true } catch { return false } }

// 旧的先清掉：源码改过却没重编的话，宁可不带，也不能带一份对不上的
fs.rmSync(OUT, { recursive: true, force: true })

if (process.platform !== 'darwin' || !has('swiftc')) {
  if (process.platform === 'darwin' && process.env.CI) {
    console.error('❌ CI 的 Mac 上找不到 swiftc，编不出自带的程序')
    process.exit(1)
  }
  console.log('跳过：自带程序要在装了 swiftc 的 Mac 上编')
  process.exit(0)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cu-build-'))
try {
  fs.mkdirSync(OUT, { recursive: true })
  for (const t of TARGETS) {
    const slices = ARCHS.map((arch) => {
      const out = path.join(tmp, `${t.name}-${arch}`)
      run('swiftc', ['-O', '-target', `${arch}-apple-macos${MIN_MACOS}`, '-o', out, path.join(ROOT, t.src), ...t.frameworks.flatMap((f) => ['-framework', f])])
      return out
    })
    const file = path.join(OUT, t.name)
    run('lipo', ['-create', '-output', file, ...slices])
    // Apple 芯片只跑签过名的程序：合并后重新做一次本地签名
    run('codesign', ['--force', '--sign', '-', file])
    fs.chmodSync(file, 0o755)
    console.log(`✓ ${path.relative(ROOT, file)}（${run('lipo', ['-archs', file]).trim()}）`)
  }
  const proto = run(path.join(OUT, 'dsh-cu'), ['version']).trim()
  console.log(`✓ 引擎协议 ${proto}`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
