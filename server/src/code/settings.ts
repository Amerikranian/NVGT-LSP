import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LanguageServerSettings {
    standardLibrary: {
		path: string
	};
    formatter: {
        maxBlankLines: number;
        indentSpaces: number;
        useTabIndent: boolean;
    };
    trace: {
        server: 'off' | 'messages' | 'verbose';
    };
}

const defaultSettings: LanguageServerSettings = {
	standardLibrary: {
		path: getRoot()
	},
    formatter: {
        maxBlankLines: 1,
        indentSpaces: 4,
        useTabIndent: false
    },
    trace: {
        server: 'off'
    }
};

let globalSettings: LanguageServerSettings = defaultSettings;

export function changeGlobalSettings(config: any) {
    globalSettings = globalSettings = <LanguageServerSettings>(config || defaultSettings);
    globalSettings.standardLibrary.path = ensureIsDir(globalSettings.standardLibrary.path);
}

export function getGlobalSettings(): LanguageServerSettings {
    return globalSettings;
}

function getRoot(): string {
	return os.platform() === 'win32' ? 'C:\\' : '/';
}

function ensureIsDir(dirpath: string): string {
	if (!dirpath || !fs.existsSync(dirpath)) return getRoot();
	return dirpath.endsWith(path.sep) ? dirpath : dirpath + path.sep;
}
