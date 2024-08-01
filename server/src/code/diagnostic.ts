import {Range} from "vscode-languageserver";
import {Diagnostic, DiagnosticSeverity} from "vscode-languageserver/node";

type DiagnosticList = Diagnostic[];

const s_diagnosticStack: DiagnosticList[] = [];

let s_currentDiagnostics: DiagnosticList = [];

function launchSession(): void {
    s_currentDiagnostics = [];
    s_diagnosticStack.push(s_currentDiagnostics);
}

function completeSession(): DiagnosticList {
    const result = s_currentDiagnostics;
    s_diagnosticStack.pop();
    if (s_diagnosticStack.length > 0) s_currentDiagnostics = s_diagnosticStack[s_diagnosticStack.length - 1];
    return result;
}

function pushDiagnostic(range: Range, message: string, severity: DiagnosticSeverity): void {
    s_currentDiagnostics.push({
        range: range,
        message: message,
        severity: severity,
        source: "NVGT",
    });
}

function addError(range: Range, message: string): void {
    pushDiagnostic(range, message, DiagnosticSeverity.Error);
}

export const diagnostic = {
    launchSession: launchSession,
    completeSession: completeSession,
    addError,
} as const;
