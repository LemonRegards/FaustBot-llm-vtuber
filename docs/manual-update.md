# 手动更新指南

> 当应用内自动下载更新缓慢或失败时，推荐使用本方式：在 FaustBot 中选择该包手动更新。

## 第一步：下载更新

打开 [https://github.com/liwusen/FaustBot-llm-vtuber/releases/latest](https://github.com/liwusen/FaustBot-llm-vtuber/releases/latest)

下载 最新的`faust-V<版本号>-without-runtime.zip`

**注意:一定是带without-runtime后缀的版本!**

## 第二步：在 FaustBot 中手动更新

1. 打开 FaustBot 的**配置窗口 → 概览页面**。
2. 找到「版本更新」卡片，点击 **「手动选择更新包」** 按钮。
3. 在弹出的文件选择对话框中，选中刚才下载的 `faust-V<版本号>-without-runtime.zip`。
4. 应用会校验更新包：
  - 文件名必须符合 `faust-Vx.y.z-without-runtime.zip` 规范；
  - 版本号必须高于当前安装版本；
  - 包必须完整（损坏的 zip 会被拒绝）。
5. 校验通过后显示「手动更新包已就绪: Vx.y.z」，点击 **「开始更新」**。
6. 弹出黑色 PowerShell 窗口，等待其执行完成(一般在1分钟之内可以完成)

## 常见问题

| 问题  | 解决  |
| --- | --- |
| 提示「文件名不符合更新包规范」 | 请确认选中的是 `faust-Vx.y.z-without-runtime.zip`，而不是 `-windows.zip` 完整包 |
| 提示「更新包版本不高于当前版本」 | 你下载的包版本不高于已安装版本,请下载最新的 |
| 提示「更新包已损坏」 | 下载不完整，请重新下载 |

## 相关

- [更新指南](updating.md)
- [安装指南](installation.md)