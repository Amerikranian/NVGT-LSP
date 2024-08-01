import * as msUri from 'vscode-uri';
import * as stdpath from 'path';
import {TokenizingToken} from "../compile/tokens";
import {Profiler} from "../code/profiler";
import {tokenize} from "../compile/tokenizer";
import {parseFromTokenized} from "../compile/parser";
import {analyzeFromParsed} from "../compile/analyzer";
import {diagnostic} from '../code/diagnostic';
import {Diagnostic} from "vscode-languageserver/node";
import {AnalyzedScope, createSymbolScope} from "../compile/scope";
import {tracer} from "../code/tracer";
import {NodeScript} from "../compile/nodes";
import {URI} from "vscode-languageserver";
import * as url from "url";
import * as path from "node:path";
import * as fs from "fs";
import {fileURLToPath} from "node:url";
import {URL} from 'url';
import {preprocessTokensForParser} from "../compile/parsingPreprocess";
import { getGlobalSettings } from '../code/settings';

interface InspectResult {
    content: string;
    diagnostics: Diagnostic[];
    tokenizedTokens: TokenizingToken[];
    parsedAst: NodeScript;
    analyzedScope: AnalyzedScope;
}

const s_inspectedResults: { [uri: string]: InspectResult } = {};
const stdlibUri = msUri.URI.file(stdpath.join(__dirname, '..', 'resources', 'as.predefined').toString()).toString();

function createEmptyResult(): InspectResult {
    return {
        content: '',
        diagnostics: [],
        tokenizedTokens: [],
        parsedAst: [],
        analyzedScope: new AnalyzedScope('', createSymbolScope(undefined, undefined, ''))
    } as const;
}

export function getInspectedResult(uri: URI): InspectResult {
    const result = s_inspectedResults[uri];
    if (result === undefined) return createEmptyResult();
    return result;
}

export function getInspectedResultList(): InspectResult[] {
    return Object.values(s_inspectedResults);
}

export function inspectFile(content: string, targetUri: URI) {
    // Load as.predefined file | as.predefined ファイルの読み込み
    const predefinedUri = checkInspectPredefined(targetUri);

    // Cache the inspected result | 解析結果をキャッシュ
    s_inspectedResults[targetUri] = inspectInternal(content, targetUri, predefinedUri);
}

export function clearInspectCache() {
	for (const uri in s_inspectedResults) {
		// We avoid wiping standard lib
		if (uri !== stdlibUri) {
			delete s_inspectedResults[uri];
		}
	}
}

function checkInspectPredefined(targetUri: URI) {
	const predefinedResult = s_inspectedResults[stdlibUri];
	if (predefinedResult !== undefined) {
		return stdlibUri;
	}

	// We haven't analyzed the URI yet
	const content = readFileFromUri(stdlibUri);
	if (content === undefined) {
		return undefined;
	}
	s_inspectedResults[stdlibUri] = inspectInternal(content, stdlibUri, undefined);
	return stdlibUri;
}

function readFileFromUri(uri: string): string | undefined {
    try {
        const path = fileURLToPath(uri);
        if (fs.existsSync(path) === false) return undefined;

        return fs.readFileSync(path, 'utf8');
    } catch (error) {
        return undefined;
    }
}

function splitUriIntoDirectories(fileUri: string): string[] {
    const parsedUrl = url.parse(fileUri);
    const currentPath = parsedUrl.pathname;
    if (currentPath === null) return [];

    const directories: string[] = [];
    let parentPath = currentPath;

    // Repeat until the directory reaches the root | ルートに達するまで繰り返す
    while (parentPath !== path.dirname(parentPath)) {
        parentPath = path.dirname(parentPath);
        directories.push(url.format({
            protocol: parsedUrl.protocol,
            slashes: true,
            hostname: parsedUrl.hostname,
            pathname: parentPath
        }));
    }

    return directories;
}

function inspectInternal(content: string, targetUri: URI, predefinedUri: URI | undefined): InspectResult {
    tracer.message(`🔬 Inspect "${targetUri}"`);

    diagnostic.launchSession();

    const profiler = new Profiler("Inspector");

    // Tokenize-phase | 字句解析
    const tokenizedTokens = tokenize(content, targetUri);
    profiler.stamp("Tokenizer");

    // Preprocess for tokenized tokens | トークン前処理
    const preprocessedTokens = preprocessTokensForParser(tokenizedTokens);
    profiler.stamp("Preprocess");

    // Parse-phase | 構文解析
    const parsedAst = parseFromTokenized(preprocessedTokens.parsingTokens);
    profiler.stamp("Parser");

    // Analyze-phase | 型解析
    const includedScopes = getIncludedScope(targetUri, predefinedUri, preprocessedTokens.includeFiles);

    const analyzedScope = analyzeFromParsed(parsedAst, targetUri, includedScopes);
    profiler.stamp("Analyzer");

    return {
        content: content,
        diagnostics: diagnostic.completeSession(),
        tokenizedTokens: tokenizedTokens,
        parsedAst: parsedAst,
        analyzedScope: analyzedScope
    };
}

function resolveUri(dir: string, relativeUri: string): string {
    const u = new URL(dir);
    return url.format(new URL(relativeUri, u));
}

function getIncludedScope(target: URI, predefinedUri: URI | undefined, includedUris: TokenizingToken[]) {
    const includedScopes = [];

    // Load as.predefined | as.predefined の読み込み
    if (target !== predefinedUri && predefinedUri !== undefined) {
        const predefinedResult = s_inspectedResults[predefinedUri];
        if (predefinedResult !== undefined) includedScopes.push(predefinedResult.analyzedScope);
    }

    // Get the analyzed scope of included files | #include されたファイルの解析済みスコープを取得
	// We also fetch settings to patch with standard library
	const settings = getGlobalSettings();
	// Should we cache this?
	// But if we do that, reloading settings could get tricky
	// We would need to update the stale uri value if settings ever reload
	const includeUri = msUri.URI.file(settings.standardLibrary.path).toString();
    for (const includeToken of includedUris) {
        const relativeUri = includeToken.text.substring(1, includeToken.text.length - 1);
        const uri = resolveUri(target, relativeUri);

        if (s_inspectedResults[uri] === undefined) {
            let content = readFileFromUri(uri);
            if (content === undefined) {
                const libFileUri = resolveUri(includeUri, relativeUri);
                content = readFileFromUri(libFileUri);
                if (content === undefined) {
                    diagnostic.addError(includeToken.location, `Could not find file in the following locations: "${fileURLToPath(uri)}", "${fileURLToPath(libFileUri)}"`);
                    continue;
                }
            }

            // Store an empty result temporarily to avoid loops caused by circular references
            // 循環参照によるループを回避するため、空を一時的に設定
            s_inspectedResults[uri] = createEmptyResult();

            s_inspectedResults[uri] = inspectInternal(content, uri, predefinedUri);
        }

        const result = s_inspectedResults[uri];
        if (result !== undefined) includedScopes.push(result.analyzedScope);
    }

    return includedScopes;
}
