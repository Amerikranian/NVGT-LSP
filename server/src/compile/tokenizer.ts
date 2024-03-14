import {Position, URI} from 'vscode-languageserver';
import {HighlightModifier, HighlightToken} from "../code/highlight";
import {Trie} from "../utils/trie";
import {Location, TokenObject} from "./token";
import {diagnostic} from "../code/diagnostic";

class ReadingState {
    str: string;
    cursor: number;
    head: Position;

    constructor(str: string) {
        this.str = str;
        this.cursor = 0;
        this.head = {line: 0, character: 0};
    }

    next(offset: number = 0) {
        return this.str[this.cursor + offset];
    }

    isEnd() {
        return this.cursor >= this.str.length;
    }

    isNext(expected: string) {
        return this.str.substring(this.cursor, this.cursor + expected.length) === expected;
    }

    isNextWrap() {
        const next = this.next();
        return next === '\r' || next === '\n';
    }

    isNextWhitespace() {
        const next = this.str[this.cursor];
        return next === ' ' || next === '\t';
    }

    stepNext() {
        if (this.isEnd()) return;

        if (this.isNextWrap()) {
            this.head.line++;
            this.head.character = 0;
            if (this.isNext('\r\n')) this.cursor += 2;
            else this.cursor += 1;
        } else {
            this.head.character++;
            this.cursor += 1;
        }
    }

    stepFor(count: number) {
        this.head.character += count;
        this.cursor += count;
    }

    copyHead() {
        return {
            line: this.head.line,
            character: this.head.character
        };
    }
}

function isDigit(str: string): boolean {
    return /^[0-9]$/.test(str);
}

function isAlnum(c: string): boolean {
    return /^[A-Za-z0-9_]$/.test(c);
}

function tryComment(reading: ReadingState) {
    if (reading.isNext('//')) {
        reading.stepFor(2);
        let comment = '//';
        for (; ;) {
            if (reading.isEnd() || reading.isNextWrap()) break;
            comment += reading.next();
            reading.stepNext();
        }
        return comment;
    }
    if (reading.isNext('/*')) {
        reading.stepFor(2);
        let comment = '/*';
        for (; ;) {
            if (reading.isEnd()) break;
            if (reading.isNext('*/')) {
                comment += '*/';
                reading.stepFor(2);
                break;
            }
            if (reading.isNext('\r\n')) comment += '\r\n';
            else comment += reading.next();
            reading.stepNext();
        }
        return comment;
    }
    return '';
}

const allSymbolArray = [
    '*', '**', '/', '%', '+', '-', '<=', '<', '>=', '>', '(', ')', '==', '!=', '?', ':', '=', '+=', '-=', '*=', '/=', '%=', '**=', '++', '--', '&', ',', '{', '}', ';', '|', '^', '~', '<<', '>>', '>>>', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '.', '&&', '||', '!', '[', ']', '^^', '@', '::',
];

const allSymbolTrie = Trie.fromArray(allSymbolArray);

function trySymbol(reading: ReadingState) {
    const symbol = allSymbolTrie.find(reading.str, reading.cursor);
    reading.stepFor(symbol.length);
    return symbol;
}

function tryNumber(reading: ReadingState) {
    let result: string = "";
    let isFloating = false;

    for (; ;) {
        if (reading.isEnd()) break;
        const next = reading.next();
        const floatStart = next === '.' && isFloating === false;
        const floatEnd = next === 'f' && isFloating;
        if (isDigit(next) || floatStart || floatEnd) {
            result += next;
            reading.stepFor(1);
            if (floatStart) isFloating = true;
            if (floatEnd) break;
        } else break;
    }

    return result;
}

const allKeywordArray = [
    'and', 'auto', 'bool', 'break', 'case', 'cast', 'catch', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'false', 'float', 'for', 'funcdef', 'if', 'import', 'in', 'inout', 'int', 'interface', 'int8', 'int16', 'int32', 'int64', 'is', 'mixin', 'namespace', 'not', 'null', 'or', 'out', 'override', 'private', 'property', 'protected', 'return', 'switch', 'true', 'try', 'typedef', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'void', 'while', 'xor',
    // Not really a reserved keyword, but is recognized by the compiler as a built-in keyword.
    // 'abstract', 'explicit', 'external', 'function', 'final', 'from', 'get', 'set', 'shared', 'super', 'this',
];

const allKeywords = new Set(allKeywordArray);

function tryIdentifier(reading: ReadingState) {
    let result: string = "";
    while (reading.isEnd() === false && isAlnum(reading.next())) {
        result += reading.next();
        reading.stepFor(1);
    }
    return result;
}

function dummyHighlight(token: HighlightToken, modifier: HighlightModifier) {
    return {
        token: token,
        modifier: modifier,
    };
}

// 英数字や記号以外の文字列のバッファ
class UnknownBuffer {
    private buffer: string = "";
    private location: Location | null = null;

    public append(head: Location, next: string) {
        if (this.location === null) this.location = head;
        else if (head.start.line !== this.location.start.line
            || head.start.character - this.location.end.character > 1) {
            this.flush();
            this.location = head;
        }
        this.location.end = head.end;
        this.buffer += next;
    }

    public flush() {
        if (this.buffer.length === 0) return;
        if (this.location === null) return;
        this.location.end.character++;
        diagnostic.addError(this.location, 'Unknown token: ' + this.buffer);
        this.buffer = "";
    }
}

export function tokenize(str: string, uri: URI) {
    const tokens: TokenObject[] = [];
    const reading = new ReadingState(str);
    const unknownBuffer = new UnknownBuffer();

    for (; ;) {
        if (reading.isEnd()) break;
        if (reading.isNextWrap()
            || reading.isNextWhitespace()) {
            reading.stepNext();
            continue;
        }

        const location = {
            start: reading.copyHead(),
            end: reading.copyHead(),
            uri: uri
        };

        // コメント
        const triedComment = tryComment(reading);
        if (triedComment.length > 0) {
            location.end = reading.copyHead();
            tokens.push({
                kind: "comment",
                text: triedComment,
                location: location,
                highlight: dummyHighlight(HighlightToken.Comment, HighlightModifier.Invalid)
            });
            continue;
        }

        // 数値
        const triedNumber = tryNumber(reading);
        if (triedNumber.length > 0) {
            location.end = reading.copyHead();
            tokens.push({
                kind: "number",
                text: triedNumber,
                location: location,
                highlight: dummyHighlight(HighlightToken.Number, HighlightModifier.Invalid)
            });
            continue;
        }

        // シンボル
        const triedSymbol = trySymbol(reading);
        if (triedSymbol.length > 0) {
            location.end = reading.copyHead();
            tokens.push({
                kind: "reserved",
                text: triedSymbol,
                location: location,
                highlight: dummyHighlight(HighlightToken.Keyword, HighlightModifier.Invalid)
            });
            continue;
        }

        // 識別子
        const triedIdentifier = tryIdentifier(reading);
        if (triedIdentifier.length > 0) {
            location.end = reading.copyHead();
            const isReserved = allKeywords.has(triedIdentifier);
            tokens.push({
                kind: isReserved ? "reserved" : "identifier",
                text: triedIdentifier,
                location: location,
                highlight: dummyHighlight(
                    isReserved ? HighlightToken.Keyword : HighlightToken.Variable,
                    HighlightModifier.Invalid)
            });
            continue;
        }

        unknownBuffer.append(location, reading.next());
        reading.stepNext();
    }

    unknownBuffer.flush();
    return tokens;
}
