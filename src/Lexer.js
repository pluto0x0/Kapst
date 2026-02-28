// @flow
/**
 * Typst-oriented lexer.
 *
 * We intentionally tokenize a compact expression language (identifiers,
 * numbers, strings, operators, punctuation) and leave semantic mapping to the
 * parser. The renderer pipeline is still KaTeX's existing AST + builders.
 */

import ParseError from "./ParseError";
import SourceLocation from "./SourceLocation";
import {Token} from "./Token";

import type {LexerInterface} from "./Token";
import type Settings from "./Settings";

// Kept for compatibility with previous imports in this codebase.
export const combiningDiacriticalMarksEndRegex: RegExp =
    /[\u0300-\u036f]+$/;

const MULTI_CHAR_OPERATORS = [
    "<=>", "<->", "=>", "->", "<-", "<=", ">=", "!=", "==",
];
const SINGLE_CHAR_OPERATORS = new Set([
    "+", "-", "*", "/", "^", "_", "=", "<", ">", "!",
]);
const PUNCTUATION = new Set([
    ",", ":", ";", ".", "(", ")", "[", "]", "{", "}", "|",
]);

/** Main Lexer class */
export default class Lexer implements LexerInterface {
    input: string;
    settings: Settings;
    tokenRegex: RegExp;
    catcodes: {[string]: number};
    pos: number;

    constructor(input: string, settings: Settings) {
        this.input = input;
        this.settings = settings;
        // SourceLocation expects a lexer-like object to carry `tokenRegex`.
        this.tokenRegex = /\s*/g;
        this.catcodes = {};
        this.pos = 0;
    }

    setCatcode(char: string, code: number) {
        // Kept for compatibility with legacy callers.
        this.catcodes[char] = code;
    }

    skipTrivia() {
        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];

            if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
                this.pos += 1;
                continue;
            }

            // Line comments.
            if (ch === "/" && this.input[this.pos + 1] === "/") {
                this.pos += 2;
                while (this.pos < this.input.length &&
                    this.input[this.pos] !== "\n") {
                    this.pos += 1;
                }
                continue;
            }

            // Block comments.
            if (ch === "/" && this.input[this.pos + 1] === "*") {
                const commentStart = this.pos;
                this.pos += 2;
                while (this.pos + 1 < this.input.length &&
                    !(this.input[this.pos] === "*" &&
                    this.input[this.pos + 1] === "/")) {
                    this.pos += 1;
                }
                if (this.pos + 1 >= this.input.length) {
                    const commentLoc = new SourceLocation(
                        this,
                        commentStart,
                        commentStart + 2,
                    );
                    throw new ParseError(
                        "Unterminated block comment",
                        new Token("/*", commentLoc, "operator"),
                    );
                }
                this.pos += 2;
                continue;
            }

            break;
        }
    }

    lexIdentifierOrKeyword(start: number): Token {
        this.pos += 1;
        while (this.pos < this.input.length &&
            /[A-Za-z0-9_]/.test(this.input[this.pos])) {
            this.pos += 1;
        }
        const text = this.input.slice(start, this.pos);
        return new Token(
            text,
            new SourceLocation(this, start, this.pos),
            "identifier",
        );
    }

    lexNumber(start: number): Token {
        let sawDot = false;

        if (this.input[this.pos] === ".") {
            sawDot = true;
            this.pos += 1;
        }

        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            if (/[0-9]/.test(ch)) {
                this.pos += 1;
                continue;
            }
            if (!sawDot && ch === ".") {
                sawDot = true;
                this.pos += 1;
                continue;
            }
            break;
        }

        const text = this.input.slice(start, this.pos);
        return new Token(
            text,
            new SourceLocation(this, start, this.pos),
            "number",
        );
    }

    lexString(start: number): Token {
        const quote = this.input[this.pos];
        this.pos += 1;

        let text = "";
        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            if (ch === quote) {
                this.pos += 1;
                return new Token(
                    text,
                    new SourceLocation(this, start, this.pos),
                    "string",
                );
            }
            if (ch === "\\") {
                if (this.pos + 1 >= this.input.length) {
                    break;
                }
                const escaped = this.input[this.pos + 1];
                switch (escaped) {
                    case "n":
                        text += "\n";
                        break;
                    case "r":
                        text += "\r";
                        break;
                    case "t":
                        text += "\t";
                        break;
                    case "\\":
                    case "\"":
                    case "'":
                        text += escaped;
                        break;
                    default:
                        // Keep unknown escapes literally to avoid silent data loss.
                        text += escaped;
                }
                this.pos += 2;
                continue;
            }
            text += ch;
            this.pos += 1;
        }

        throw new ParseError(
            "Unterminated string literal",
            new Token(quote, new SourceLocation(this, start, start + 1), "string"),
        );
    }

    lexOperatorOrPunctuation(start: number): ?Token {
        for (let i = 0; i < MULTI_CHAR_OPERATORS.length; i++) {
            const op = MULTI_CHAR_OPERATORS[i];
            if (this.input.startsWith(op, start)) {
                this.pos += op.length;
                return new Token(
                    op,
                    new SourceLocation(this, start, this.pos),
                    "operator",
                );
            }
        }

        const ch = this.input[start];
        if (SINGLE_CHAR_OPERATORS.has(ch)) {
            this.pos += 1;
            return new Token(
                ch,
                new SourceLocation(this, start, this.pos),
                "operator",
            );
        }
        if (PUNCTUATION.has(ch)) {
            this.pos += 1;
            return new Token(
                ch,
                new SourceLocation(this, start, this.pos),
                "punctuation",
            );
        }
        return null;
    }

    /**
     * Lex a single token.
     */
    lex(): Token {
        this.skipTrivia();

        const start = this.pos;
        if (start >= this.input.length) {
            return new Token(
                "EOF",
                new SourceLocation(this, start, start),
                "EOF",
            );
        }

        const ch = this.input[start];

        if (/[A-Za-z_]/.test(ch)) {
            return this.lexIdentifierOrKeyword(start);
        }

        if (/[0-9]/.test(ch) ||
            (ch === "." && /[0-9]/.test(this.input[start + 1] || ""))) {
            return this.lexNumber(start);
        }

        if (ch === '"' || ch === "'") {
            return this.lexString(start);
        }

        const opOrPunctuation = this.lexOperatorOrPunctuation(start);
        if (opOrPunctuation) {
            return opOrPunctuation;
        }

        throw new ParseError(
            `Unexpected character: '${ch}'`,
            new Token(ch, new SourceLocation(this, start, start + 1), "legacy"),
        );
    }
}
