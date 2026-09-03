<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://jsray.org/assets/brand/jsray-logo-hero-dark.svg">
    <img src="https://jsray.org/assets/brand/jsray-logo-hero-light.svg" alt="JSRay" width="420">
  </picture>
</p>

[English](README.md) · **简体中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.0.1--beta-lightgrey)](CHANGELOG.md)
[![Channel](https://img.shields.io/badge/channel-beta-blue)](CHANGELOG.md)
[![Core](https://img.shields.io/badge/JSRay%20Core-0.0.1--beta.1-success)](https://github.com/jsrayorg/jsray)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2018-339933)](package.json)

> 面向终端的 JSRay 代码渲染 · ANSI 真彩 · 35 个语言族 · 零依赖

<sub>内部测试版 · 尚未发布公开测试版 · 内置 JSRay Core 快照</sub>

---

当前仓库是围绕 [JSRay Core](https://github.com/jsrayorg/jsray) 的独立**终端 CLI** 项目——JSRay 生态中的官方开源集成,拥有自己的版本号与更新日志。

它**内置 Core 的快照**(`vendor/jsray.cjs`),而不是在运行时依赖 Core。因此在你主动执行同步之前,CLI 的行为与发布当天完全一致。

## 功能

`jsray` 用 ANSI 颜色在终端里渲染代码,背后是与其它所有 JSRay 表面**完全相同的分词器和调色板**:`JSRay.tokenize()` 产出与渲染器无关的 token 流,本项目把它映射为 ANSI 转义序列,而不是 HTML span。九族分离同样保留——参数斜体琥珀,声明加粗薄荷,关键字加粗。

- **35 个语言族**(Core 支持的全部),依据文件扩展名、特殊文件名(`Dockerfile`、`Makefile`)或内容自动识别
- **4 款调色板 × 明暗两态**:default、aurora、ember、fjord
- 默认 **truecolor**,并提供 xterm-256 降采样与纯文本回退;输出被管道接收时自动降级为纯文本
- **零依赖**——只需 Node ≥ 18

## 用法

```sh
jsray src/app.py                        # 渲染文件
cat query.sql | jsray                   # 从标准输入读取,自动识别
jsray notes.md --theme aurora           # 选择调色板
jsray config.toml --mode light          # 明色变体
jsray server.go -n                      # 显示行号
jsray build.log --color none            # 强制纯文本
jsray --list-languages                  # 列出 Core 支持的全部语言
jsray --list-themes
```

语言判定顺序:`--lang` → 文件扩展名 → 特殊文件名 → 对内容执行 `JSRay.detectLanguage()`。无法识别的输入会退化为纯文本,而不是报错。

颜色判定:`--color auto`(默认)在 `COLORTERM` 宣告真彩时使用 truecolor,否则使用 xterm-256;当 stdout 不是 TTY 时输出纯文本。可用 `--color truecolor|256|none` 覆盖。

## 安装

```sh
npm link          # 在仓库根目录执行,把 `jsray` 挂到 PATH 上
```

## 项目结构

```
jsray-terminal/
├── bin/jsray.mjs       ← CLI:参数、输入输出、语言判定
├── lib/ansi.mjs        ← token 流 → ANSI(truecolor / 256 / none)
├── vendor/jsray.cjs    ← Core 运行时快照 —— 请勿手改
├── palettes/           ← 从 Core 同步的调色板 JSON —— 请勿手改
├── tools/              ← sync-core.sh · check-versions.mjs
└── tests/              ← node --test 测试(渲染器 + 端到端 CLI)
```

## 同步 Core

修改 Core 项目后,先在 Core 中重建 `dist/`(执行 `sh build.sh`),然后:

```sh
npm run sync:core      # 默认在 ../jsray 寻找 Core,也可设置 JSRAY_CORE_DIR
```

只要同级存在 Core 检出,`npm run check:versions` 就会在快照漂移时报错。

## 内核完整性校验

CLI 直接运行磁盘上的内置引擎 —— 也就是说,真正渲染你代码的那个文件,离"被某个 `npm install` 脚本换掉"只有一步之遥。`core-integrity.json` 钉住了 JSRay Core 为该快照发布的摘要,每次运行都会校验(哈希 ~70KB 的开销远小于 Node 自身启动)。

```sh
jsray --verify-core
# official build verified — JSRay Core 0.0.1-beta.2, 6 files
```

不匹配时警告走 **stderr** 并照常渲染,绝不污染管道;`--verify-core` 会以非零码退出,便于写进脚本。

## 自定义调色板

```sh
jsray app.js --palette ~/my-colors.json          # 叠加在 --theme 之上
jsray app.js --theme fjord --palette ~/tweak.json
```

接受与其它所有 JSRay 表面相同的 JSON —— 即[主题工作台](https://jsray.org/studio.html)导出的格式 —— 因此一份调色板文件在终端、网页和编辑器里通用。没写的 token 沿用内置调色板取值。键名按内置的 `vocabulary.json` 校验;来自更新版 Core 的未知键会在 stderr 上提示并跳过,而不是直接报错。

## 渲染器边界

ANSI 层只消费生态约定的 token 流契约(`tokenize(code, lang)` → 字符串与 `{type, content}` 节点)。任何产出该形状的渲染器都可以直接放进 `vendor/` 使用。

## 开发

```sh
npm test
npm run check:versions
```
