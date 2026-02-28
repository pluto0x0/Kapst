# Typst Math Syntax Subset for This KaTeX Fork

## 1. Source references

- Typst Math reference (core syntax and math module):
  - https://typst.app/docs/reference/math/
  - https://raw.githubusercontent.com/typst/typst/main/docs/reference/math.md
- Typst scripting syntax (operator precedence):
  - https://raw.githubusercontent.com/typst/typst/main/docs/reference/syntax.md
- Typst scripting (let bindings, function calls):
  - https://raw.githubusercontent.com/typst/typst/main/docs/reference/scripting.md
- Typst math definitions pages (for signatures/examples):
  - accent: https://typst.app/docs/reference/math/accent/
  - cases: https://typst.app/docs/reference/math/cases/
  - frac: https://typst.app/docs/reference/math/frac/
  - root/sqrt: https://typst.app/docs/reference/math/root/ and https://typst.app/docs/reference/math/sqrt/

## 2. Important Typst syntax observations

### 2.1 Math expressions are code-like

The Typst math reference states equations can contain arbitrary Typst expressions and are interpreted with math definitions in scope.

Practical implication for this fork:
- We should parse formula input with expression grammar, not TeX command grammar.
- We can support a useful subset first (not full Typst evaluator).

### 2.2 Attachments (sub/superscript)

From Typst math reference:
- Subscript and superscript are attached with `_` and `^`.
- The parser should allow chaining and grouping.

Subset implementation:
- `x_1`, `x^2`, `x_1^2`.
- Grouped attachment via `{...}` in parser subset.

### 2.3 Fractions and roots

From Typst math reference:
- `/` is a fraction syntax in math.
- `sqrt` and `root` are math definitions.

Subset implementation:
- `a / b` maps to KaTeX `genfrac` node (via existing `\frac` handler).
- `sqrt(x)` maps to KaTeX `sqrt` node.
- `root(n, x)` maps to KaTeX `sqrt` node with index.

### 2.4 Function calls and variable definitions

From Typst scripting reference:
- Function call syntax is `f(x, y)`.
- `let name = expr` creates bindings.

Subset implementation:
- Statement-level `let` bindings are supported in the parser.
- A later identifier lookup substitutes the bound parse-node sequence.
- No closures/modules/structured values are implemented.

### 2.5 Operator precedence

From Typst syntax precedence table:
- Multiplication/division bind stronger than addition/subtraction.
- Comparisons bind weaker than arithmetic.
- Assignment is weaker than comparison (full assignment expression is out of scope here).

Subset implementation order (high -> low):
1. postfix attachments (`^`, `_`)
2. multiplicative (`*`, `/`, implicit juxtaposition)
3. additive (`+`, `-`)
4. comparison (`=`, `!=`, `<`, `<=`, `>`, `>=`)

### 2.6 Definitions: accent and cases

From Typst definition pages:
- `accent(content, accent, ...)` supports rich optional parameters.
- `cases(..)` supports rich content forms.

Subset implementation:
- `accent(base, kind)` only, where `kind` is a simple identifier/string.
- `cases(a, b; c, d; ...)` only (semicolon-separated rows, comma-separated columns).
- Advanced named arguments/options and full content polymorphism are out of scope.

## 3. Supported syntax subset (this implementation)

- literals: numbers, identifiers, strings
- grouping: `{...}` (semantic grouping), `(...)` / `[...]` (visible delimiters)
- binary operators: `+ - * / = == != < <= > >= -> <- <-> => <=>`
- implicit multiplication by juxtaposition
- postfix scripts: `^` and `_`
- function call: `name(arg1, arg2, ...)`
- statements: `let x = expr; expr`

Builtin function subset:
- structural: `frac`, `sqrt`, `root`, `accent`, `cases`
- accents (short form): `hat`, `bar`, `tilde`, `dot`, `ddot`, `vec`, `overline`, `underline`
- delimiter helpers: `abs`, `norm`, `floor`, `ceil`
- operator names: `sin`, `cos`, `tan`, `ln`, `log`, `exp`, `lim`, `max`, `min`, `sum`, `prod`, `int`

## 4. Explicit non-goals in this phase

- Full Typst evaluator semantics (modules, blocks, dictionaries, loops, conditionals)
- Full Typst math definition argument system (named args, defaults, relative units, content/string unions)
- Complete symbol catalog parity with Typst
- LaTeX backward compatibility

## 5. Examples for this subset

- `let a = x^2; frac(a + 1, sqrt(y))`
- `accent(a, arrow)`
- `cases(x, "if x >= 0"; -x, "otherwise")`
- `sum_(i=1)^n i / n`

## 6. KaTeX workflow analysis (before vs after)

### 6.1 Original KaTeX parse pipeline (LaTeX-oriented)

- Entry: `src/parseTree.js`
- Core chain:
  - `parseTree(...)` creates `Parser`
  - `Parser` pulls tokens from `MacroExpander` (`gullet`)
  - `MacroExpander` pulls raw tokens from `Lexer`
  - `Parser` dispatches TeX control sequences through `functions[...]`
- Key characteristics:
  - syntax depends on TeX token model (`\\commands`, brace args, macro expansion)
  - parser behavior and many environments depend on `gullet` state

### 6.2 This fork’s pipeline (Typst-subset-oriented)

- Entry still remains `src/parseTree.js`, but it now directly returns `parser.parse()`.
- New core chain:
  - `parseTree(...)` creates `Parser`
  - `Parser` directly consumes tokens from a Typst-style `Lexer`
  - no TeX macro expansion layer in the new parse path
- Retained compatibility points:
  - parse result is still KaTeX parse node structure
  - rendering still uses existing HTML/MathML builders
  - many builtins are mapped by calling existing function handlers (e.g. `\\frac`, `\\sqrt`, `\\hat`, `\\sum`)

### 6.3 Modified syntax-layer modules

- `src/Token.js`
  - added token category (`kind`) to distinguish identifiers, numbers, strings, operators, punctuation.
- `src/Lexer.js`
  - replaced TeX token regex strategy with Typst-subset tokenizer.
  - added support for line/block comments and multi-char operators.
- `src/Parser.js`
  - replaced TeX grammar with expression grammar + precedence.
  - implemented subset function calls and statement-level `let` binding.
  - maps Typst subset constructs to existing KaTeX parse nodes.
- `src/parseTree.js`
  - removed macro-state cleanup/tag-specific TeX logic from parse entry.
