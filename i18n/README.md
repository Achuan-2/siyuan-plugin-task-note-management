维护文案后运行 `pnpm check:i18n`，检查中英文键、插值参数、代码引用、Svelte 界面硬编码文案和控制台日志。界面文案使用 i18n，控制台日志固定使用英文，不调用 i18n；检查覆盖独立窗口中的嵌入脚本。运行 `pnpm test:i18n` 验证语言兜底、参数替换、重复任务描述和日志规则。

思源支持的 i18n 文件范围，可以在控制台 `siyuan.config.langs` 中查看。以下是思源 3.7.0 起使用的语言标识：

The i18n files supported by SiYuan can be viewed in the console under `siyuan.config.langs`. The following language identifiers are used since SiYuan 3.7.0:

```js
>>> siyuan.config.langs.map( lang => lang.name)
['ar', 'de', 'en', 'es', 'fr', 'he', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'sk', 'th', 'tr', 'uk', 'zh-CN', 'zh-TW']
```

在插件开发中，默认使用 JSON 格式作为国际化（i18n）的载体文件。如果您更喜欢使用 YAML 语法，可以将 JSON 文件替换为 YAML 文件（例如 `en.yaml`），并在其中编写 i18n 文本。本模板提供了相关的 Vite 插件，可以在编译时自动将 YAML 文件转换为 JSON 文件（请参见 `/yaml-plugin.js`）。本 MD 文件和 YAML 文件会在 `pnpm build` 时自动从 `dist` 目录下删除，仅保留必要的 JSON 文件供插件系统使用。

In plugin development, JSON format is used by default as the carrier file for internationalization (i18n). If you prefer to use YAML syntax, you can replace the JSON file with a YAML file (e.g., `en.yaml`) and write the i18n text within it. This template provides a related Vite plugin that can automatically convert YAML files to JSON files during compilation (see `/yaml-plugin.js`). This Markdown file and YAML files are automatically removed from `dist` when running `pnpm build`, leaving only the JSON files required by the plugin system.
