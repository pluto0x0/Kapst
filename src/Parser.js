// @flow
import functions from "./functions";
import symbols, {ATOMS} from "./symbols";
import ParseError from "./ParseError";
import Lexer from "./Lexer";
import Settings from "./Settings";
import {Token} from "./Token";

import type {AnyParseNode} from "./parseNode";
import type {Atom, Group} from "./symbols";
import type {Mode} from "./types";

const COMPARISON_OPERATORS = new Set([
    "=", "==", "!=", "<", "<=", ">", ">=", "->", "<-", "<->", "=>", "<=>",
]);
const ADDITIVE_OPERATORS = new Set(["+", "-"]);
const MULTIPLICATIVE_OPERATORS = new Set(["*", "/"]);
const NON_PREFIX_TOKENS = new Set([
    "+", "-", "*", "/", "^", "_", "=", "==", "!=", "<", "<=", ">", ">=",
]);

const OPERATOR_SYMBOL_MAP = {
    "*": "\\cdot",
    "==": "=",
    "!=": "\\ne",
    "<=": "\\leq",
    ">=": "\\geq",
    "->": "\\to",
    "<-": "\\leftarrow",
    "<->": "\\leftrightarrow",
    "=>": "\\Rightarrow",
    "<=>": "\\Leftrightarrow",
};

// Common Typst symbol names mapped to existing KaTeX symbols/operators.
const NAMED_SYMBOLS = {
    alpha: "\\alpha",
    beta: "\\beta",
    gamma: "\\gamma",
    delta: "\\delta",
    epsilon: "\\epsilon",
    zeta: "\\zeta",
    eta: "\\eta",
    theta: "\\theta",
    iota: "\\iota",
    kappa: "\\kappa",
    lambda: "\\lambda",
    mu: "\\mu",
    nu: "\\nu",
    xi: "\\xi",
    pi: "\\pi",
    rho: "\\rho",
    sigma: "\\sigma",
    tau: "\\tau",
    upsilon: "\\upsilon",
    phi: "\\phi",
    chi: "\\chi",
    psi: "\\psi",
    omega: "\\omega",
    Gamma: "\\Gamma",
    Delta: "\\Delta",
    Theta: "\\Theta",
    Lambda: "\\Lambda",
    Xi: "\\Xi",
    Pi: "\\Pi",
    Sigma: "\\Sigma",
    Upsilon: "\\Upsilon",
    Phi: "\\Phi",
    Psi: "\\Psi",
    Omega: "\\Omega",
    oo: "\\infty",
    infty: "\\infty",
};

// Operator names that already have KaTeX handlers.
const NAMED_OPERATORS = {
    sin: "\\sin",
    cos: "\\cos",
    tan: "\\tan",
    ln: "\\ln",
    log: "\\log",
    exp: "\\exp",
    lim: "\\lim",
    max: "\\max",
    min: "\\min",
    sum: "\\sum",
    prod: "\\prod",
    int: "\\int",
};

const ACCENT_CALLS = {
    hat: "\\hat",
    bar: "\\bar",
    tilde: "\\tilde",
    dot: "\\dot",
    ddot: "\\ddot",
    vec: "\\vec",
    overline: "\\overline",
    underline: "\\underline",
};

const ACCENT_NAME_MAP = {
    hat: "\\hat",
    bar: "\\bar",
    tilde: "\\tilde",
    dot: "\\dot",
    ddot: "\\ddot",
    vec: "\\vec",
    arrow: "\\vec",
    acute: "\\acute",
    grave: "\\grave",
    check: "\\check",
    breve: "\\breve",
    overline: "\\overline",
    underline: "\\underline",
};

export default class Parser {
    mode: Mode;
    lexer: Lexer;
    settings: Settings;
    nextToken: ?Token;
    definitions: {[string]: AnyParseNode[]};

    constructor(input: string, settings: Settings) {
        this.mode = "math";
        this.lexer = new Lexer(input, settings);
        this.settings = settings;
        this.nextToken = null;
        this.definitions = {};
    }

    expect(text: string, consume?: boolean = true) {
        if (this.fetch().text !== text) {
            throw new ParseError(
                `Expected '${text}', got '${this.fetch().text}'`,
                this.fetch(),
            );
        }
        if (consume) {
            this.consume();
        }
    }

    consume() {
        this.nextToken = null;
    }

    fetch(): Token {
        if (this.nextToken == null) {
            this.nextToken = this.lexer.lex();
        }
        return this.nextToken;
    }

    switchMode(newMode: Mode) {
        this.mode = newMode;
    }

    /**
     * Parses statement list and returns the last expression result.
     *
     * Supported statement form:
     *   let name = expr;
     */
    parse(): AnyParseNode[] {
        let lastExpression: AnyParseNode[] = [];

        while (this.fetch().text !== "EOF") {
            if (this.isLetStatement()) {
                this.parseLetStatement();
            } else {
                lastExpression = this.parseExpression(new Set([";", "EOF"]));
            }

            if (this.fetch().text === ";") {
                this.consume();
            } else if (this.fetch().text !== "EOF") {
                throw new ParseError(
                    "Expected ';' or end of input",
                    this.fetch(),
                );
            }
        }

        this.expect("EOF");
        return lastExpression;
    }

    isLetStatement(): boolean {
        const token = this.fetch();
        return token.kind === "identifier" && token.text === "let";
    }

    parseLetStatement() {
        this.consume(); // let

        const nameToken = this.fetch();
        if (nameToken.kind !== "identifier") {
            throw new ParseError("Expected identifier after 'let'", nameToken);
        }
        const name = nameToken.text;
        this.consume();

        this.expect("=");
        const value = this.parseExpression(new Set([";", "EOF"]));
        this.definitions[name] = this.cloneNodes(value);
    }

    parseExpression(stopTokens: Set<string>): AnyParseNode[] {
        return this.parseComparison(stopTokens);
    }

    parseComparison(stopTokens: Set<string>): AnyParseNode[] {
        let left = this.parseAdditive(stopTokens);
        while (!stopTokens.has(this.fetch().text) &&
            COMPARISON_OPERATORS.has(this.fetch().text)) {
            const operatorToken = this.fetch();
            this.consume();
            const right = this.parseAdditive(stopTokens);
            if (right.length === 0) {
                throw new ParseError(
                    "Expected expression after comparison operator",
                    operatorToken,
                );
            }
            left = left.concat([this.makeOperatorNode(operatorToken)])
                .concat(right);
        }
        return left;
    }

    parseAdditive(stopTokens: Set<string>): AnyParseNode[] {
        let left = this.parseMultiplicative(stopTokens);
        while (!stopTokens.has(this.fetch().text) &&
            ADDITIVE_OPERATORS.has(this.fetch().text)) {
            const operatorToken = this.fetch();
            this.consume();
            const right = this.parseMultiplicative(stopTokens);
            if (right.length === 0) {
                throw new ParseError(
                    "Expected expression after additive operator",
                    operatorToken,
                );
            }
            left = left.concat([this.makeOperatorNode(operatorToken)])
                .concat(right);
        }
        return left;
    }

    parseMultiplicative(stopTokens: Set<string>): AnyParseNode[] {
        let left = this.parseUnary(stopTokens);
        if (left.length === 0) {
            return left;
        }

        let keepParsing = true;
        while (keepParsing) {
            const token = this.fetch();
            const text = token.text;

            if (text === "EOF" || stopTokens.has(text) ||
                COMPARISON_OPERATORS.has(text) || ADDITIVE_OPERATORS.has(text)) {
                break;
            }

            if (MULTIPLICATIVE_OPERATORS.has(text)) {
                this.consume();
                const right = this.parseUnary(stopTokens);
                if (right.length === 0) {
                    throw new ParseError(
                        "Expected expression after multiplicative operator",
                        token,
                    );
                }

                if (text === "/") {
                    const numer = this.nodesToArgument(left);
                    const denom = this.nodesToArgument(right);
                    left = [this.callFunction("\\frac", [numer, denom], [], token)];
                } else {
                    left = left.concat([this.makeOperatorNode(token)])
                        .concat(right);
                }
                continue;
            }

            // Juxtaposition in Typst math behaves as implicit multiplication.
            if (this.canStartPrimary(token, stopTokens)) {
                const right = this.parseUnary(stopTokens);
                if (right.length === 0) {
                    break;
                }
                left = left.concat(right);
                continue;
            }

            keepParsing = false;
        }

        return left;
    }

    parseUnary(stopTokens: Set<string>): AnyParseNode[] {
        const token = this.fetch();
        if (token.text === "EOF" || stopTokens.has(token.text)) {
            return [];
        }

        if (token.text === "+") {
            this.consume();
            return this.parseUnary(stopTokens);
        }

        if (token.text === "-") {
            this.consume();
            const body = this.parseUnary(stopTokens);
            if (body.length === 0) {
                throw new ParseError("Expected expression after unary '-'", token);
            }
            return [this.makeOperatorNode(token)].concat(body);
        }

        return this.parsePostfix(stopTokens);
    }

    parsePostfix(stopTokens: Set<string>): AnyParseNode[] {
        const base = this.parsePrimary(stopTokens);
        if (base == null) {
            return [];
        }

        let superscript;
        let subscript;

        while (this.fetch().text === "^" || this.fetch().text === "_") {
            const token = this.fetch();
            this.consume();

            const script = this.parseScriptArgument();
            if (token.text === "^") {
                if (superscript) {
                    throw new ParseError("Double superscript", token);
                }
                superscript = script;
            } else {
                if (subscript) {
                    throw new ParseError("Double subscript", token);
                }
                subscript = script;
            }
        }

        if (superscript || subscript) {
            return [{
                type: "supsub",
                mode: this.mode,
                base,
                sup: superscript,
                sub: subscript,
            }];
        }

        return [base];
    }

    parseScriptArgument(): AnyParseNode {
        if (this.fetch().text === "{") {
            this.consume();
            const body = this.parseExpression(new Set(["}"]));
            this.expect("}");
            return this.nodesToArgument(body);
        }

        const script = this.parseUnary(new Set([
            "EOF", ";", ",", ")", "]", "}",
            "+", "-", "*", "/", "^", "_",
            "=", "==", "!=", "<", "<=", ">",
            ">=", "->", "<-", "<->", "=>", "<=>",
        ]));

        if (script.length === 0) {
            throw new ParseError(
                "Expected expression after script marker",
                this.fetch(),
            );
        }

        return this.nodesToArgument(script);
    }

    parsePrimary(stopTokens: Set<string>): ?AnyParseNode {
        const token = this.fetch();

        if (token.text === "EOF" || stopTokens.has(token.text)) {
            return null;
        }

        if (token.kind === "identifier") {
            return this.parseIdentifier(token);
        }

        if (token.kind === "number") {
            this.consume();
            return {
                type: "textord",
                mode: this.mode,
                loc: token.loc,
                text: token.text,
            };
        }

        if (token.kind === "string") {
            this.consume();
            return this.makeTextNode(token.text, token);
        }

        if (token.text === "(") {
            return this.parseVisibleGroup("(", ")");
        }
        if (token.text === "[") {
            return this.parseVisibleGroup("[", "]");
        }
        if (token.text === "{") {
            this.consume();
            const body = this.parseExpression(new Set(["}"]));
            this.expect("}");
            return {
                type: "ordgroup",
                mode: this.mode,
                body,
            };
        }

        if (token.text === ")" || token.text === "]" || token.text === "}") {
            return null;
        }

        if (NON_PREFIX_TOKENS.has(token.text)) {
            return null;
        }

        // Fall back to symbol parsing for punctuation/operators that are
        // meaningful as literal math symbols.
        this.consume();
        return this.makeSymbolNode(token.text, token);
    }

    parseVisibleGroup(open: string, close: string): AnyParseNode {
        const openToken = this.fetch();
        this.consume();

        const inner = this.parseExpression(new Set([close]));
        const closeToken = this.fetch();
        this.expect(close);

        const openNode = this.makeSymbolNode(
            this.normalizeDelimiter(open),
            openToken,
        );
        const closeNode = this.makeSymbolNode(
            this.normalizeDelimiter(close),
            closeToken,
        );
        return this.makeOrdGroup([openNode].concat(inner).concat([closeNode]));
    }

    parseIdentifier(token: Token): AnyParseNode {
        this.consume();
        const name = token.text;

        if (this.fetch().text === "(") {
            return this.parseCall(name, token);
        }

        if (this.definitions[name]) {
            return this.nodesToArgument(this.cloneNodes(this.definitions[name]));
        }

        if (NAMED_SYMBOLS.hasOwnProperty(name)) {
            return this.makeSymbolNode(NAMED_SYMBOLS[name], token);
        }

        if (NAMED_OPERATORS.hasOwnProperty(name)) {
            return this.callFunction(NAMED_OPERATORS[name], [], [], token);
        }

        if (name.length === 1) {
            return this.makeSymbolNode(name, token);
        }

        const body = [];
        for (let i = 0; i < name.length; i++) {
            const charToken = new Token(name[i], token.loc, "identifier");
            body.push(this.makeSymbolNode(name[i], charToken));
        }
        return this.makeOrdGroup(body);
    }

    parseCall(name: string, nameToken: Token): AnyParseNode {
        if (name === "cases") {
            return this.parseCasesCall(nameToken);
        }

        const args = this.parseCallArguments();

        if (name === "frac") {
            if (args.length !== 2) {
                throw new ParseError(
                    "frac() expects exactly 2 arguments",
                    nameToken,
                );
            }
            return this.callFunction(
                "\\frac",
                [this.nodesToArgument(args[0]), this.nodesToArgument(args[1])],
                [],
                nameToken,
            );
        }

        if (name === "sqrt") {
            if (args.length !== 1) {
                throw new ParseError(
                    "sqrt() expects exactly 1 argument",
                    nameToken,
                );
            }
            return this.callFunction(
                "\\sqrt",
                [this.nodesToArgument(args[0])],
                [null],
                nameToken,
            );
        }

        if (name === "root") {
            if (args.length !== 2) {
                throw new ParseError(
                    "root() expects exactly 2 arguments",
                    nameToken,
                );
            }
            return this.callFunction(
                "\\sqrt",
                [this.nodesToArgument(args[1])],
                [this.nodesToArgument(args[0])],
                nameToken,
            );
        }

        if (name === "accent") {
            return this.parseAccentCall(args, nameToken);
        }

        if (ACCENT_CALLS.hasOwnProperty(name)) {
            if (args.length !== 1) {
                throw new ParseError(
                    `${name}() expects exactly 1 argument`,
                    nameToken,
                );
            }
            return this.callFunction(
                ACCENT_CALLS[name],
                [this.nodesToArgument(args[0])],
                [],
                nameToken,
            );
        }

        if (name === "abs" || name === "norm" ||
            name === "floor" || name === "ceil") {
            if (args.length !== 1) {
                throw new ParseError(
                    `${name}() expects exactly 1 argument`,
                    nameToken,
                );
            }
            return this.makeDelimiterNode(name, args[0]);
        }

        if (NAMED_OPERATORS.hasOwnProperty(name)) {
            const opNode = this.callFunction(
                NAMED_OPERATORS[name],
                [],
                [],
                nameToken,
            );
            const callSuffix = this.makeParenthesizedArgsNode(args);
            return this.makeOrdGroup([opNode, callSuffix]);
        }

        // Fallback: render as `name(args...)` using literal symbols.
        const fallbackNameNode = name.length === 1
            ? this.makeSymbolNode(name, nameToken)
            : this.makeOrdGroup(name.split("").map(ch =>
                this.makeSymbolNode(
                    ch,
                    new Token(ch, nameToken.loc, "identifier"),
                )
            ));
        const fallbackCall = this.makeParenthesizedArgsNode(args);
        return this.makeOrdGroup([fallbackNameNode, fallbackCall]);
    }

    parseCallArguments(): AnyParseNode[][] {
        this.expect("(");
        const args = [];

        if (this.fetch().text !== ")") {
            let keepParsing = true;
            while (keepParsing) {
                args.push(this.parseExpression(new Set([",", ")"])));
                if (this.fetch().text === ",") {
                    this.consume();
                } else {
                    keepParsing = false;
                }
            }
        }

        this.expect(")");
        return args;
    }

    parseCasesCall(nameToken: Token): AnyParseNode {
        this.expect("(");
        const rows: AnyParseNode[][][] = [];
        let row: AnyParseNode[][] = [];

        if (this.fetch().text !== ")") {
            let keepParsing = true;
            while (keepParsing) {
                const cell = this.parseExpression(new Set([",", ";", ")"]));
                row.push(cell);

                if (this.fetch().text === ",") {
                    this.consume();
                    continue;
                }
                if (this.fetch().text === ";") {
                    this.consume();
                    rows.push(row);
                    row = [];
                    continue;
                }
                keepParsing = false;
            }
        }

        if (row.length > 0) {
            rows.push(row);
        }
        this.expect(")");

        if (rows.length === 0) {
            throw new ParseError("cases() expects at least one case", nameToken);
        }

        let maxCols = 1;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].length > maxCols) {
                maxCols = rows[i].length;
            }
        }

        const cols = [];
        for (let i = 0; i < maxCols; i++) {
            cols.push({
                type: "align",
                align: "l",
                pregap: 0,
                postgap: i === 0 && maxCols > 1 ? 1.0 : 0,
            });
        }

        const body = rows.map((cells) => {
            const normalized = cells.slice();
            while (normalized.length < maxCols) {
                normalized.push([]);
            }

            return normalized.map((cell) => ({
                type: "styling",
                mode: this.mode,
                style: "text",
                body: [this.nodesToArgument(cell)],
            }));
        });

        const rowGaps = [];
        for (let i = 0; i < Math.max(0, body.length - 1); i++) {
            rowGaps.push(null);
        }

        const hLinesBeforeRow = [];
        for (let i = 0; i < body.length + 1; i++) {
            hLinesBeforeRow.push([]);
        }

        const arrayNode = {
            type: "array",
            mode: this.mode,
            arraystretch: 1.2,
            cols,
            body,
            rowGaps,
            hLinesBeforeRow,
        };

        return {
            type: "leftright",
            mode: this.mode,
            body: [arrayNode],
            left: "\\{",
            right: ".",
            rightColor: undefined,
        };
    }

    parseAccentCall(args: AnyParseNode[][], nameToken: Token): AnyParseNode {
        if (args.length !== 2) {
            throw new ParseError("accent() expects exactly 2 arguments", nameToken);
        }

        const base = this.nodesToArgument(args[0]);
        const accentName = this.extractPlainText(args[1]);
        if (!accentName) {
            throw new ParseError(
                "accent() second argument must be a simple identifier or string",
                nameToken,
            );
        }

        const command = ACCENT_NAME_MAP[accentName.trim().toLowerCase()];
        if (!command) {
            throw new ParseError(
                `Unsupported accent type '${accentName}'`,
                nameToken,
            );
        }

        return this.callFunction(command, [base], [], nameToken);
    }

    makeParenthesizedArgsNode(args: AnyParseNode[][]): AnyParseNode {
        const body = [];
        for (let i = 0; i < args.length; i++) {
            if (i > 0) {
                body.push(
                    this.makeSymbolNode(
                        ",",
                        new Token(",", null, "punctuation"),
                    ),
                );
            }
            body.push(this.nodesToArgument(args[i]));
        }
        return this.makeOrdGroup([
            this.makeSymbolNode("(", new Token("(", null, "punctuation")),
            ...body,
            this.makeSymbolNode(")", new Token(")", null, "punctuation")),
        ]);
    }

    makeDelimiterNode(name: string, argument: AnyParseNode[]): AnyParseNode {
        let left;
        let right;
        if (name === "abs") {
            left = "|";
            right = "|";
        } else if (name === "norm") {
            left = "\\|";
            right = "\\|";
        } else if (name === "floor") {
            left = "\\lfloor";
            right = "\\rfloor";
        } else {
            left = "\\lceil";
            right = "\\rceil";
        }
        return {
            type: "leftright",
            mode: this.mode,
            body: argument,
            left,
            right,
            rightColor: undefined,
        };
    }

    makeTextNode(text: string, token: Token): AnyParseNode {
        const body = [];
        for (let i = 0; i < text.length; i++) {
            body.push({
                type: "textord",
                mode: "text",
                text: text[i],
            });
        }
        return {
            type: "text",
            mode: this.mode,
            loc: token.loc,
            body,
        };
    }

    makeOperatorNode(token: Token): AnyParseNode {
        const mapped = OPERATOR_SYMBOL_MAP[token.text] || token.text;
        return this.makeSymbolNode(mapped, token);
    }

    normalizeDelimiter(delim: string): string {
        if (delim === "{") {
            return "\\{";
        }
        if (delim === "}") {
            return "\\}";
        }
        return delim;
    }

    makeOrdGroup(body: AnyParseNode[]): AnyParseNode {
        return {
            type: "ordgroup",
            mode: this.mode,
            body,
        };
    }

    nodesToArgument(nodes: AnyParseNode[]): AnyParseNode {
        if (nodes.length === 1) {
            return nodes[0];
        }
        return this.makeOrdGroup(nodes);
    }

    canStartPrimary(token: Token, stopTokens: Set<string>): boolean {
        if (token.text === "EOF" || stopTokens.has(token.text)) {
            return false;
        }
        if (token.kind === "identifier" ||
            token.kind === "number" ||
            token.kind === "string") {
            return true;
        }
        return token.text === "(" || token.text === "[" || token.text === "{";
    }

    makeSymbolNode(text: string, token: Token): AnyParseNode {
        if (symbols[this.mode][text]) {
            const symbolEntry = symbols[this.mode][text];
            const group: Group = symbolEntry.group;
            if (ATOMS.hasOwnProperty(group)) {
                const family: Atom = (group: any);
                return {
                    type: "atom",
                    mode: this.mode,
                    family,
                    loc: token.loc,
                    text,
                };
            }
            return {
                type: (group: any),
                mode: this.mode,
                loc: token.loc,
                text,
            };
        }

        // If no predefined symbol exists, keep it as a text ord to avoid
        // dropping user content in the subset parser.
        return {
            type: "textord",
            mode: this.mode,
            loc: token.loc,
            text,
        };
    }

    callFunction(
        name: string,
        args: AnyParseNode[],
        optArgs: (?AnyParseNode)[],
        token?: Token,
    ): AnyParseNode {
        const func = functions[name];
        if (!func || !func.handler) {
            throw new ParseError(`Unsupported function '${name}'`, token);
        }
        return func.handler({
            funcName: name,
            parser: this,
            token,
            breakOnTokenText: undefined,
        }, args, optArgs);
    }

    extractPlainText(nodes: AnyParseNode[]): ?string {
        const chunks = [];

        const walk = (node: AnyParseNode): boolean => {
            if (node.type === "textord" ||
                node.type === "mathord" ||
                node.type === "atom") {
                chunks.push(node.text);
                return true;
            }
            if (node.type === "ordgroup") {
                for (let i = 0; i < node.body.length; i++) {
                    if (!walk(node.body[i])) {
                        return false;
                    }
                }
                return true;
            }
            if (node.type === "text") {
                for (let i = 0; i < node.body.length; i++) {
                    if (node.body[i].type !== "textord") {
                        return false;
                    }
                    chunks.push(node.body[i].text);
                }
                return true;
            }
            return false;
        };

        for (let i = 0; i < nodes.length; i++) {
            if (!walk(nodes[i])) {
                return null;
            }
        }

        return chunks.join("");
    }

    cloneValue(value: mixed): mixed {
        if (Array.isArray(value)) {
            return value.map(item => this.cloneValue(item));
        }
        if (value && typeof value === "object") {
            const out = {};
            const keys = Object.keys((value: Object));
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                // Source locations carry lexer references and are not needed for
                // substituted bindings.
                if (key === "loc") {
                    continue;
                }
                out[key] = this.cloneValue(value[key]);
            }
            return out;
        }
        return value;
    }

    cloneNodes(nodes: AnyParseNode[]): AnyParseNode[] {
        return nodes.map(node => ((this.cloneValue(node): any): AnyParseNode));
    }
}
