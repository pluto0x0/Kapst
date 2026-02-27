# KaTeX 项目架构与 Lexer/Parser 深度分析

本文基于对当前仓库（`/home/flayed/Kapst`）的完整目录扫描与核心源码阅读，重点覆盖你后续要改造的解析链路（Lexer/Parser），用于评估如何适配 Typst 风格公式输入。

## 1. 文件结构、技术和开放方式

### 1.1 仓库整体结构（按职责分层）

- `src/`: 核心渲染引擎与解析器源码。
  - `Lexer.js`、`MacroExpander.js`、`Parser.js`、`parseTree.js`: 从字符串到 AST 的核心链路。
  - `functions/`、`environments/`: 函数和环境语义注册与实现（通过 `defineFunction` / `defineEnvironment`）。
  - `buildTree.js`、`buildHTML.js`、`buildMathML.js`: 从 AST 到 HTML/MathML 的构建层。
  - `symbols.js`、`macros.js`: 语法符号表与内建宏表。
  - `styles/`: SCSS 样式源文件。
- `contrib/`: 官方扩展模块，不属于 core parser，但与主包一起构建发布。
  - `auto-render/`: 扫描页面文本并自动识别定界符渲染公式。
  - `mhchem/`: 化学公式扩展（`\ce` / `\pu`）。
  - `copy-tex/`: 复制公式时导出 LaTeX 源串。
  - `mathtex-script-type/`: 兼容 MathJax 的 `<script type="math/tex">`。
  - `render-a11y-string/`: 辅助可访问性字符串渲染。
- `test/`: Jest 单测、快照、截图测试入口。
  - `katex-spec.js`、`errors-spec.js`: parser/错误行为的重要回归集。
  - `screenshotter/`: 视觉回归测试数据。
- `docs/`: 用户与开发文档（API、CLI、options、supported 命令）。
- `static/`: 本地调试页面源码（`yarn start` 启动后访问）。
- `website/`: 文档站点工程。
- `dockers/`: 字体指标生成、截图测试、TeX 对比工具。
- `fonts/`: 预编译字体资源。
- `types/`: TypeScript 类型声明（`katex.d.ts`）。
- 根目录构建入口与配置:
  - `katex.js`: 主入口 API（`render`/`renderToString`/`__parse` 等）。
  - `katex.webpack.js`: webpack 专用入口（含样式导入）。
  - `webpack.*.js`、`rollup.config.js`、`babel.config.js`: 构建配置。
  - `cli.js`: 命令行渲染入口。

### 1.2 关键技术栈（以及 TypeScript 的真实位置）

- 语言与类型系统:
  - 主源码是 JavaScript + Flow 注解（大量 `// @flow`）。
  - 不是 TypeScript 源码仓库；TypeScript 主要用于对外类型声明（`types/katex.d.ts`）和基本 `tsconfig.json` 约束。
- 构建与打包:
  - Babel: 转译 Flow/现代语法。
  - Webpack: 产出 UMD/CSS/字体资源，区分 dev/prod/min。
  - Rollup: 产出 ESM 版本（`.mjs`）。
- 测试:
  - Jest: parser、builder、错误处理、快照测试。
  - Screenshot tests: 渲染结果视觉对比（`dockers/screenshotter`）。
- 包管理:
  - Yarn 4（`packageManager: yarn@4.1.1`）。
- 静态资源:
  - SCSS + PostCSS + cssnano。

### 1.3 开放方式（API、扩展点、开发/调试）

- 对外 API:
  - `katex.render` / `katex.renderToString`。
  - 内部能力暴露: `__parse`、`__defineFunction`、`__defineMacro`、`__setFontMetrics`（不承诺稳定）。
- 扩展机制:
  - 语义扩展通过 `defineFunction` 与 `defineEnvironment` 注册。
  - 宏扩展通过 `defineMacro` 与运行时 `settings.macros`。
  - `contrib/` 扩展独立打包并通过 `exports` 子路径暴露。
- 本地开发/调试建议路径:
  - 安装依赖: `corepack enable && yarn`
  - 启动调试页面: `yarn start`，访问 `http://localhost:7936/`
  - parser 回归测试: `yarn test:jest`
  - 仅更新快照: `yarn test:jest:update`
  - 全量检查: `yarn test`（lint + flow + jest）
  - 打包产物: `yarn build`
- 调试特点:
  - `static/index.html + static/main.js` 是高效手工调试入口，支持实时输入、选项面板、permalink 回放。
  - 你改 Lexer/Parser 时，最有价值的是 `test/errors-spec.js` 与 `test/katex-spec.js`。

---

## 2. 核心逻辑：Lexer + Parser（字符串到语法树）

### 2.1 总体调用链

1. `katex.render(...)` / `renderToString(...)`
2. `parseTree(expression, settings)`
3. `new Parser(input, settings)`
4. `Parser.parse()`
5. `Parser.fetch()` 通过 `MacroExpander.expandNextToken()` 取 token
6. `MacroExpander` 在需要时从 `Lexer.lex()` 拉取原始 token，并做宏展开
7. `Parser.parseExpression / parseAtom / parseGroup / parseFunction ...` 构造 AST（`parseNode`）
8. 返回 `AnyParseNode[]`（后续再进入 HTML/MathML builder）

本质上是 TeX 风格的三段式：
- Mouth: `Lexer`
- Gullet: `MacroExpander`
- Stomach: `Parser`

### 2.2 Lexer：把字符流切成 Token

文件：`src/Lexer.js`

- 核心机制:
  - 维护 `tokenRegex` 和 `lastIndex`，按顺序单步词法扫描。
  - `lex()` 每次返回一个 `Token(text, SourceLocation)`。
- token 规则:
  - 空白、控制词（`\foo`）、控制符（`\,` 等）、普通 Unicode 字符、`\verb` 特例都在一个大正则中处理。
  - 支持组合附加符（combining marks）与代理对（surrogate pair）。
- catcode 支持（精简版 TeX）:
  - 默认 `%`=注释字符（14），`~`=active（13）。
  - `parseUrlGroup` 中会临时改 catcode（例如把 `%` 当普通活动字符），解析后再恢复。
- 注释处理:
  - 读到 `%` 后跳过到行尾，递归 `lex()` 继续。
  - 若注释直到 EOF，会触发 nonstrict 报告。
- 错误定位:
  - 任何无法匹配字符会抛 `ParseError`，并带上精确 `SourceLocation`。

### 2.3 MacroExpander：宏展开与 token 栈管理

文件：`src/MacroExpander.js`

- 数据结构:
  - `stack`: 逆序 token 栈（push/pop 顶端）。
  - `lexer`: 底层 token 来源。
  - `macros`: 分组作用域命名空间（`Namespace`），预置 + 用户宏。
- 关键方法:
  - `future()`: 看下一个未展开 token（不消费）。
  - `popToken()` / `pushToken()` / `pushTokens()`。
  - `consumeArg/consumeArgs()`: 按 TeX 规则吃参数（支持定界参数）。
  - `expandOnce()`:
    - 取栈顶 token，查 `_getExpansion(name)`。
    - 若可展开：替换参数占位符 `#1..#9`，把展开结果压回栈。
    - 若不可展开：放回并返回 `false`。
  - `expandNextToken()`:
    - 循环 `expandOnce()`，直到得到“最终不可展开 token”。
- 安全阈值:
  - `expansionCount` + `settings.maxExpand` 防止宏无限递归。
- “定义性”判定:
  - `isDefined` 会同时看宏、函数、符号表、隐式命令（如 `^` `_`）。

这层对 Typst 适配的影响很大：如果你新增 Typst 语法但不想破坏 TeX 宏体系，通常要避免直接冲击 `expandOnce` 的控制流。

### 2.4 Parser：把 Token 序列变成 AST

文件：`src/Parser.js`

- 核心状态:
  - `mode`: `math` / `text`。
  - `nextToken`: 单 token lookahead。
  - `gullet`: 宏展开器。
- 主入口 `parse()`:
  - 建立 group 作用域（非 `globalGroup`）。
  - `parseExpression(false)` 解析主体。
  - 最后强制 `expect("EOF")`。
- 表达式层 `parseExpression(...)`:
  - 循环读取 atom，遇 `}`、`\end`、`\right`、`&` 等终止符停止。
  - math 模式忽略空格。
  - 最后调用 `handleInfixNodes` 把 `\over` 等 infix 重写成函数节点（如 `\frac`）。
- 原子层 `parseAtom(...)`:
  - 先取 base：`parseGroup("atom")`。
  - 再解析后缀：`^` / `_` / `'` / Unicode 上下标，产出 `supsub` 节点。
- 组与函数:
  - `parseGroup(...)`: 处理 `{...}`、`\begingroup...\endgroup`、函数调用、符号。
  - `parseFunction(...)`: 按 `functions[func]` 的声明解析参数并执行 handler。
  - `parseArguments(...)` + `parseGroupOfType(...)`: 按 `argTypes` 做强类型参数解析（`color`、`size`、`url`、`raw`、`primitive` 等）。
- 环境:
  - `\begin/\end` 在 `src/functions/environment.js` 中作为函数实现。
  - 通过 `environments[envName]` 查定义并调用对应 handler。
- 符号:
  - `parseSymbol()` 查 `symbols[mode]`，处理 Unicode、组合重音、`\verb`。
- 错误处理:
  - 各阶段使用 `expect(...)` 和类型断言抛 `ParseError`，错误文本在测试集中有大量快照保障。

### 2.5 AST 形态（Parser 输出）

文件：`src/parseNode.js`

- 输出是 `AnyParseNode[]`。
- 常见节点:
  - `ordgroup`, `atom`, `textord`, `supsub`, `genfrac`, `accent`, `array`, `environment`, `infix`, `internal` 等。
- 每个节点至少包含 `type`, `mode`，多数包含 `loc`，用于后续 builder 和错误定位。

### 2.6 面向 Typst 适配：你应该改哪里

以下是从“最小入侵”到“结构性改造”的建议顺序。

#### 路线 A（推荐起步）：前置转换层（Typst -> TeX）

- 在 Parser 前加一层转换，把 Typst 公式转换成尽量等价的 TeX，再走原链路。
- 优点:
  - 不破坏现有 Lexer/MacroExpander/Parser 语义。
  - 回归成本低，Jest 覆盖可直接复用。
- 风险:
  - Typst 与 TeX 语义不完全同构时，映射会越来越复杂。

#### 路线 B：扩展 Lexer + Parser（你当前目标）

1. Lexer 层改造点:
- `tokenRegexString` 扩展 Typst 特有词法单元（例如新运算符、多字符标记）。
- 注意不要破坏现有控制序列分支（`\\[a-zA-Z@]+`）和 `\verb` 特例。
- 如需注释规则差异（Typst 风格注释），要与 `%` catcode 共存或模式化切换。

2. Parser 层改造点:
- `parseExpression` 的终止符集合与优先级策略。
- `parseAtom` 的后缀规则（Typst 上下标或函数调用习惯差异）。
- `parseGroup` / `parseFunction`：支持 Typst 风格分组、命名参数、分隔符规则。
- 若引入新节点类型，需要同步 `parseNode.js` + 对应 html/mathml builders。

3. MacroExpander 协调点:
- 若 Typst 输入不依赖 TeX 宏，考虑在“Typst 模式”下减少/禁用宏展开，或限定展开集合。
- 必须保留 `maxExpand` 等安全机制。

#### 路线 C：双语法 Parser（TeX 与 Typst 并行）

- 增加 `inputFormat: "tex" | "typst"` 设置。
- 在入口处分流到不同 parser 实现，减少互相污染。
- 工程成本更高，但长期可维护性通常优于把 Typst 全塞进 TeX parser。

### 2.7 对你当前改造最关键的工程建议

- 先定义“支持的 Typst 子集”与 TeX 兼容边界，再动代码。
- 先加测试后改实现：
  - 在 `test/errors-spec.js` 增加失败路径（错误信息与定位）。
  - 在 `test/katex-spec.js` 增加成功路径（AST/渲染行为）。
- 小步迭代改造顺序建议:
  1. Lexer 新 token
  2. Parser 的 parseExpression / parseAtom
  3. 新节点类型与 builder（如有）
  4. 补快照与截图回归
- 保持一条原则：不要在同一批改动里同时重写“词法规则 + 宏展开策略 + 节点语义”，否则很难定位回归来源。

---

## 附：本仓库中的“真实技术判断”结论

- KaTeX 核心并非 TypeScript 项目，而是 Flow 注解 JavaScript 项目。
- TypeScript 在本仓库中主要承担对外声明（`types/katex.d.ts`）。
- 你要改 Lexer/Parser，应以 `src/*.js`（Flow 风格）为主，不是改 TS 源码。
