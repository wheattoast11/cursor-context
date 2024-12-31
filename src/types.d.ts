declare module 'node-nlp' {
    export class NlpManager {
        constructor(options: { languages: string[] });
    }
}

declare module 'tf-idf-search' {
    export class TfIdf {
        constructor();
    }
}

declare module 'escomplex' {
    export function analyse(ast: any): {
        aggregate: {
            cyclomatic: number;
        };
    };
}

declare module 'esprima' {
    export function parseModule(code: string): {
        body: Array<{
            type: string;
            source: {
                value: string;
            };
        }>;
    };
}

declare module 'complexity-report' {
    interface Dependency {
        path: string;
        type: string;
    }

    interface Report {
        aggregate: {
            cyclomatic: number;
            sloc: number;
            maintainability: number;
        };
        dependencies: Dependency[];
        functions: any[];
    }

    interface Options {
        forms?: boolean;
        streams?: boolean;
        dependencies?: boolean;
    }

    export function run(code: string, options?: Options): Report;
} 