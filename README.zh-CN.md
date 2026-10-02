# 浏览器插件一站式上线

[English](README.md)

`browser-extension-launch` 是一个面向非技术用户的 Agent Skill：用户只需说明想做什么、试用第一版并确认发布安排，AI 负责组织浏览器插件的需求、开发、真实浏览器检查、发布材料和后续更新。

## 能做什么

- 从一句自然语言需求开始制作 Chrome Manifest V3 插件。
- 默认在本地保存任务与进度，不要求 GitHub。
- 按需调用产品设计、Chrome 扩展开发、脚手架、排错和代码审查 skills。
- 使用 Playwright MCP 对当前插件产物执行真实入口与重复使用检查。
- 生成和检查发布包，协助准备 Chrome Web Store 文案、权限说明和隐私材料。
- 明确区分源码完成、真实验收、提交审核和商店上线。

## 真实项目案例

下面三个 Chrome 插件由独立 Codex CLI 会话使用本 skill 的流程开发，均完成了真实浏览器验收和规范／需求两部分审查。仓库包含源码、可加载的 `extension/`、最终报告和开发会话记录。

| 项目 | 功能 | 已验证范围 |
| --- | --- | --- |
| [外链直达](https://github.com/xiehuan123/direct-link) | 自动还原掘金、知乎和 CSDN 的中转链接，支持总开关与分站开关 | 三站真实中转 URL、动态来源链接还原、开关关闭与弹窗重开 |
| [网页取色](https://github.com/xiehuan123/page-color-picker) | 从当前可见网页截图取色，转换 HEX/RGB/HSL，复制并保存近期颜色 | 实际像素取色、格式与复制、历史连续操作、扩展重载后保留 |
| [广告净化](https://github.com/xiehuan123/quiet-web) | 拦截有限范围的常见广告请求，支持页面隐藏、站点暂停和允许清单 | 网络拦截与放行、广告正例与保护对象、站点控制、浏览器重开后保留设置 |

这些案例验证的是各仓库报告中列明的范围，不代表覆盖所有网站、所有广告或网站未来改版。它们目前是源码和本地安装包项目，尚未提交 Chrome Web Store。

## 安装

使用 npm 安装：

```bash
npx browser-extension-launch install
```

也可以将整个仓库放入所用 Agent 支持的 skills 目录，并保持 `SKILL.md` 位于技能根目录。

Codex 的个人安装示例：

```bash
git clone https://github.com/xiehuan123/browser-extension-launch.git ~/.codex/skills/browser-extension-launch
```

重新打开会话后，可以直接说：

```text
使用 $browser-extension-launch，帮我做一个浏览器插件：选中网页上的一句话就能收藏，关掉再打开还能找到。我不会编程，先做出来给我自己用。
```

完整的新手说明见[使用说明](使用说明.md)。不同 Agent 的 skill 安装目录、浏览器工具和权限模型可能不同，请按对应宿主调整。

## 目录

```text
SKILL.md          技能入口
agents/           Codex 界面元数据
references/       开发、验收、发布及依赖说明
scripts/          项目记录、验收门禁和发布包检查工具
tests/            脚本测试
assets/           Chrome MV3 参考模板
docs/             英文与中文 GitHub Pages 官网
```

## 开发检查

脚本使用 Python 3.9+ 标准库，npm 安装器测试使用 Node.js 18+。运行测试：

```bash
npm test
npm pack --dry-run
```

验证 skill 基本结构：

```bash
python3 /path/to/skill-creator/scripts/quick_validate.py .
```

结构校验脚本需要 PyYAML。浏览器插件的实际交付还需要本 skill 所列的必需子技能与可加载扩展的 Playwright MCP 环境。

## 官网

项目网站发布在 [xiehuan123.github.io/browser-extension-launch](https://xiehuan123.github.io/browser-extension-launch/)。

## 许可证

[MIT](LICENSE)
