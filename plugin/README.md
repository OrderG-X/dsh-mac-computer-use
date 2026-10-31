# Mac 桌面操作 · dsh-mac-computer-use

DeepSeek Harness（DSH）插件：让模型看屏幕、点按钮、打字，直接操作你 Mac 上的应用。它提供 11 个 `desktop_*` 工具，包括窗口列表、截图、按文字找（OCR）、给元素编号、点击、输入、按键、滚动、拖拽和启动应用。

点击和输入直接发给目标程序，不移动你的鼠标，也不抢前台。

只支持 macOS 11 及以上，Apple 芯片和 Intel 都能用。安装包里带着编好的程序，不用编译。

## 安装

在 DSH「插件」页点「添加插件」，填 `dsh-mac-computer-use`，然后重启 DSH。DSH 连不上 npm 时会自动换国内镜像。

第一次用，要在系统设置里给 DeepSeek Harness 开「屏幕录制」和「辅助功能」权限。插件设置页有直达按钮。

## 更新

在「插件」页把它卸载，再添加一次。DSH 用 pnpm 安装插件，而 pnpm 默认不装刚发布的版本，所以新版大约发布一天后，按包名才能装到。

## English

A DSH plugin that lets the model see the screen and control the Mac through 11 `desktop_*` tools:

- window list, screenshots, OCR text search and numbered elements
- click, type, keys, scroll, drag and app launch

Clicks and typing go straight to the target app. Your real pointer never moves, and the app is not brought to the front.

It needs macOS 11 or later and runs on Apple silicon and Intel. The package ships prebuilt binaries.

**Install:** in DSH, open the Plugins page, click Add plugin and enter `dsh-mac-computer-use`, then restart DSH. On first use, grant DeepSeek Harness the Screen Recording and Accessibility permissions.

**Update:** uninstall the plugin and add it again. A new version can be installed by package name about a day after release, because the pnpm that DSH uses skips brand-new versions by default.

完整说明 / Full docs: https://github.com/OrderG-X/dsh-mac-computer-use
