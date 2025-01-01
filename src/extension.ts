// src/extension.ts
import * as vscode from 'vscode';
import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as chokidar from 'chokidar';
import * as tf from '@tensorflow/tfjs-node';
import { simpleGit, SimpleGit } from 'simple-git';
import { NlpManager } from 'node-nlp';
import * as esprima from 'esprima';
import * as escomplex from 'escomplex';
import { TfIdf } from 'tf-idf-search';
import * as ts from 'typescript';

interface CodeMetrics {
    complexity: number;
    sloc: number;
    dependencies: string[];
    typeInfo: string;
}

interface GitMetadata {
    lastCommit: string;
    author: string;
    commitMessage: string;
    branch: string;
}

interface ContextRow {
    id: number;
    file_path: string;
    content: string;
    metadata: string;
    complexity_metrics: string;
    git_metadata: string;
    relationships?: string;
    cluster_name?: string;
}

class ContextTreeDataProvider implements vscode.TreeDataProvider<ContextEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ContextEntry | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private contextManager: ContextManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ContextEntry): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ContextEntry): Promise<ContextEntry[]> {
        if (element) {
            return [];
        } else {
            return this.contextManager.getRecentEntries();
        }
    }
}

class ContextEntry extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
    }
}

class CodeInsightsProvider implements vscode.TreeDataProvider<InsightItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<InsightItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private contextManager: ContextManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: InsightItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: InsightItem): Promise<InsightItem[]> {
        if (element) {
            return this.getInsightDetails(element);
        }
        return this.getTopLevelInsights();
    }

    private async getTopLevelInsights(): Promise<InsightItem[]> {
        const insights: InsightItem[] = [
            new InsightItem(
                'Complexity Hotspots',
                vscode.TreeItemCollapsibleState.Collapsed,
                'complexity'
            ),
            new InsightItem(
                'Dependency Analysis',
                vscode.TreeItemCollapsibleState.Collapsed,
                'dependencies'
            ),
            new InsightItem(
                'Recent Changes',
                vscode.TreeItemCollapsibleState.Collapsed,
                'changes'
            )
        ];
        return insights;
    }

    private async getInsightDetails(item: InsightItem): Promise<InsightItem[]> {
        switch (item.contextValue) {
            case 'complexity':
                return this.getComplexityHotspots();
            case 'dependencies':
                return this.getDependencyInsights();
            case 'changes':
                return this.getRecentChanges();
            default:
                return [];
        }
    }

    private async getComplexityHotspots(): Promise<InsightItem[]> {
        return new Promise((resolve, reject) => {
            this.contextManager.db.all(
                `SELECT file_path, complexity_metrics
                FROM context_entries
                WHERE complexity_metrics IS NOT NULL
                ORDER BY json_extract(complexity_metrics, '$.complexity') DESC
                LIMIT 5`,
                [],
                (err, rows: any[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const items = rows.map(row => {
                        const metrics = JSON.parse(row.complexity_metrics);
                        return new InsightItem(
                            `${path.basename(row.file_path)} (Complexity: ${metrics.complexity})`,
                            vscode.TreeItemCollapsibleState.None,
                            'file',
                            {
                                command: 'vscode.open',
                                title: 'Open File',
                                arguments: [vscode.Uri.file(row.file_path)]
                            }
                        );
                    });
                    resolve(items);
                }
            );
        });
    }

    private async getDependencyInsights(): Promise<InsightItem[]> {
        return new Promise((resolve, reject) => {
            this.contextManager.db.all(
                `SELECT file_path, complexity_metrics
                FROM context_entries
                WHERE complexity_metrics IS NOT NULL`,
                [],
                (err, rows: any[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const dependencyMap = new Map<string, Set<string>>();
                    rows.forEach(row => {
                        const metrics = JSON.parse(row.complexity_metrics);
                        metrics.dependencies.forEach((dep: string) => {
                            if (!dependencyMap.has(dep)) {
                                dependencyMap.set(dep, new Set());
                            }
                            dependencyMap.get(dep)?.add(row.file_path);
                        });
                    });

                    const items = Array.from(dependencyMap.entries())
                        .filter(([_, files]) => files.size > 1)
                        .sort((a, b) => b[1].size - a[1].size)
                        .slice(0, 5)
                        .map(([dep, files]) => {
                            return new InsightItem(
                                `${dep} (Used in ${files.size} files)`,
                                vscode.TreeItemCollapsibleState.None,
                                'dependency'
                            );
                        });

                    resolve(items);
                }
            );
        });
    }

    private async getRecentChanges(): Promise<InsightItem[]> {
        return new Promise((resolve, reject) => {
            this.contextManager.db.all(
                `SELECT file_path, git_metadata
                FROM context_entries
                WHERE git_metadata IS NOT NULL
                ORDER BY json_extract(git_metadata, '$.timestamp') DESC
                LIMIT 5`,
                [],
                (err, rows: any[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const items = rows.map(row => {
                        const gitData = JSON.parse(row.git_metadata);
                        return new InsightItem(
                            `${path.basename(row.file_path)} (${gitData.author})`,
                            vscode.TreeItemCollapsibleState.None,
                            'file',
                            {
                                command: 'vscode.open',
                                title: 'Open File',
                                arguments: [vscode.Uri.file(row.file_path)]
                            }
                        );
                    });
                    resolve(items);
                }
            );
        });
    }
}

class InsightItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);

        this.tooltip = this.label;
        this.iconPath = this.getIcon();
    }

    private getIcon(): { id: string } {
        switch (this.contextValue) {
            case 'complexity':
                return { id: 'warning' };
            case 'dependencies':
                return { id: 'references' };
            case 'changes':
                return { id: 'git-commit' };
            case 'file':
                return { id: 'file-code' };
            case 'dependency':
                return { id: 'package' };
            default:
                return { id: 'info' };
        }
    }
}

class ContextManager {
    public readonly db: sqlite3.Database;
    private statusBar: vscode.StatusBarItem;
    private watcher: chokidar.FSWatcher = chokidar.watch('', {
        ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/out/**', '**/dist/**'],
        persistent: true,
        ignoreInitial: true
    });
    private git: SimpleGit;
    private nlpManager: NlpManager;
    private tfidf: TfIdf;
    private embeddings: Map<string, Float32Array>;
    private model!: tf.GraphModel;
    private treeDataProvider: ContextTreeDataProvider;
    
    constructor(private context: vscode.ExtensionContext) {
        // Initialize database in extension's global storage path
        const dbPath = path.join(context.globalStorageUri.fsPath, 'context.db');
        this.db = new sqlite3.Database(dbPath);
        
        // Initialize other components
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.treeDataProvider = new ContextTreeDataProvider(this);
        this.embeddings = new Map();
        this.git = simpleGit();
        this.nlpManager = new NlpManager({ languages: ['en'] });
        this.tfidf = new TfIdf();
        
        // Setup components
        this.setup().catch(err => {
            vscode.window.showErrorMessage(`Failed to initialize Cursor Context: ${err.message}`);
        });
    }
    
    private async setup() {
        await this.initDatabase();
        this.setupStatusBar();
        this.setupWatcher();
        this.registerCommands();
        this.registerViews();
        this.model = await this.initializeEmbeddingModel();
    }
    
    private async initDatabase() {
        return new Promise<void>((resolve, reject) => {
            this.db.serialize(() => {
                // Context entries with vector embeddings
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS context_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        file_path TEXT,
                        content TEXT,
                        metadata TEXT,
                        embedding BLOB,
                        complexity_metrics TEXT,
                        git_metadata TEXT,
                        type_info TEXT,
                        semantic_tokens TEXT
                    )
                `);

                // Knowledge graph relationships
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS relationships (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        source_id INTEGER,
                        target_id INTEGER,
                        relationship_type TEXT,
                        weight REAL,
                        FOREIGN KEY(source_id) REFERENCES context_entries(id),
                        FOREIGN KEY(target_id) REFERENCES context_entries(id)
                    )
                `);

                // Sprint summaries
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS sprint_summaries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        start_date DATETIME,
                        end_date DATETIME,
                        summary TEXT,
                        decisions TEXT,
                        next_actions TEXT
                    )
                `);

                // Code clusters
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS code_clusters (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        cluster_name TEXT,
                        files TEXT,
                        complexity_score REAL,
                        description TEXT
                    )
                `, function(this: sqlite3.RunResult, err: Error | null) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }
    
    private setupStatusBar() {
        this.statusBar.text = "$(database) Context";
        this.statusBar.tooltip = "Show Context History";
        this.statusBar.command = 'cursor-context.showContext';
        this.statusBar.show();
    }
    
    private setupWatcher() {
        // Watch for file changes
        this.watcher.on('add', async (filepath) => {
            try {
                const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filepath));
                await this.processFile(filepath, content.toString());
            } catch (err) {
                console.error(`Error processing file ${filepath}:`, err);
            }
        });

        this.watcher.on('change', async (filepath) => {
            try {
                const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filepath));
                await this.processFile(filepath, content.toString());
            } catch (err) {
                console.error(`Error processing file ${filepath}:`, err);
            }
        });

        // Set up workspace folder watching
        if (vscode.workspace.workspaceFolders) {
            vscode.workspace.workspaceFolders.forEach(folder => {
                this.watcher.add(folder.uri.fsPath);
            });
        }

        // Watch for workspace folder changes
        vscode.workspace.onDidChangeWorkspaceFolders(event => {
            event.added.forEach(folder => this.watcher.add(folder.uri.fsPath));
            event.removed.forEach(folder => this.watcher.unwatch(folder.uri.fsPath));
        });
    }
    
    private registerCommands() {
        // Show context command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('cursor-context.showContext', () => {
                this.showContextPanel();
            })
        );
        
        // Clear context command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('cursor-context.clearContext', () => {
                this.clearContext();
            })
        );

        // Show context details command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('cursor-context.showContextDetails', (entry) => {
                this.showContextDetails(entry);
            })
        );

        // Search context command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('cursor-context.searchContext', async () => {
                const query = await vscode.window.showInputBox({
                    prompt: 'Enter search query',
                    placeHolder: 'Search in context history...'
                });

                if (query) {
                    await this.searchContext(query);
                }
            })
        );
    }
    
    private async processFile(filepath: string, content: string) {
        try {
            // Generate embeddings
            const embedding = await this.generateEmbedding(content);
            
            // Calculate code metrics
            const metrics = this.analyzeCodeMetrics(content, filepath);
            
            // Get git metadata
            const gitMetadata = await this.getGitMetadata(filepath);
            
            // Extract type information
            const typeInfo = this.extractTypeInfo(content, filepath);
            
            // Store everything
            await this.storeEnhancedContext(filepath, content, embedding, metrics, gitMetadata, typeInfo);
        } catch (error) {
            console.error('Error processing file:', error);
        }
    }
    
    private async initializeEmbeddingModel() {
        await tf.ready();
        // Load Universal Sentence Encoder
        const model = await tf.loadGraphModel(
            'https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1',
            { fromTFHub: true }
        );
        return model;
    }
    
    private async generateEmbedding(content: string): Promise<Float32Array> {
        try {
            // Split content into chunks to handle large files
            const chunks = this.splitIntoChunks(content);
            const embeddings: Float32Array[] = [];

            for (const chunk of chunks) {
                // Convert text to tensor
                const input = tf.tensor2d([chunk]);
                
                // Generate embedding
                const embedding = await this.model.predict(input) as tf.Tensor;
                const values = await embedding.data();
                
                // Cleanup
                input.dispose();
                embedding.dispose();
                
                embeddings.push(new Float32Array(values));
            }

            // Combine chunk embeddings (average them)
            const combinedEmbedding = new Float32Array(embeddings[0].length);
            for (const embedding of embeddings) {
                for (let i = 0; i < embedding.length; i++) {
                    combinedEmbedding[i] += embedding[i];
                }
            }
            for (let i = 0; i < combinedEmbedding.length; i++) {
                combinedEmbedding[i] /= embeddings.length;
            }

            return combinedEmbedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            // Fallback to simple hash-based embedding
            return this.generateSimpleEmbedding(content);
        }
    }
    
    private generateSimpleEmbedding(content: string): Float32Array {
        const words = content.toLowerCase().split(/\W+/);
        const embedding = new Float32Array(512).fill(0);
        
        words.forEach((word, i) => {
            const hash = this.simpleHash(word);
            embedding[hash % 512] += 1;
        });
        
        return embedding;
    }
    
    private splitIntoChunks(content: string): string[] {
        const maxChunkSize = 500; // Maximum words per chunk
        const words = content.split(/\s+/);
        const chunks: string[] = [];
        
        for (let i = 0; i < words.length; i += maxChunkSize) {
            chunks.push(words.slice(i, i + maxChunkSize).join(' '));
        }
        
        return chunks;
    }
    
    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
    
    private analyzeCodeMetrics(content: string, filepath: string): CodeMetrics {
        let complexity = 0;
        let dependencies: string[] = [];
        
        try {
            if (filepath.endsWith('.ts') || filepath.endsWith('.js')) {
                const ast = esprima.parseModule(content);
                const analysis = escomplex.analyse(ast);
                complexity = analysis.aggregate.cyclomatic;
                
                // Extract imports
                ast.body
                    .filter((node: any) => node.type === 'ImportDeclaration')
                    .forEach((node: any) => {
                        if (node.source && typeof node.source.value === 'string') {
                            dependencies.push(node.source.value);
                        }
                    });
            }
        } catch (error) {
            console.error('Error analyzing code metrics:', error);
        }
        
        return {
            complexity,
            sloc: content.split('\n').length,
            dependencies,
            typeInfo: ''
        };
    }
    
    private async getGitMetadata(filepath: string): Promise<GitMetadata> {
        try {
            const log = await this.git.log({ file: filepath, maxCount: 1 });
            const status = await this.git.status();
            const latest = log.latest;
            
            return {
                lastCommit: latest?.hash ?? '',
                author: latest?.author_name ?? '',
                commitMessage: latest?.message ?? '',
                branch: status.current || ''
            };
        } catch (error) {
            console.error('Error getting git metadata:', error);
            return {
                lastCommit: '',
                author: '',
                commitMessage: '',
                branch: ''
            };
        }
    }
    
    private extractTypeInfo(content: string, filepath: string): string {
        if (!filepath.endsWith('.ts') && !filepath.endsWith('.tsx')) {
            return '';
        }

        const sourceFile = ts.createSourceFile(
            filepath,
            content,
            ts.ScriptTarget.Latest,
            true
        );

        const typeInfo: any = {
            interfaces: [],
            types: [],
            classes: [],
            functions: []
        };

        function visit(node: ts.Node) {
            if (ts.isInterfaceDeclaration(node)) {
                typeInfo.interfaces.push({
                    name: node.name.text,
                    members: node.members.map(member => ({
                        name: member.name?.getText(),
                        type: ts.isPropertySignature(member) ? member.type?.getText() : undefined
                    }))
                });
            } else if (ts.isTypeAliasDeclaration(node)) {
                typeInfo.types.push({
                    name: node.name.text,
                    type: node.type.getText()
                });
            } else if (ts.isClassDeclaration(node)) {
                typeInfo.classes.push({
                    name: node.name?.text || 'Anonymous',
                    members: node.members.map(member => ({
                        name: member.name?.getText(),
                        type: ts.isPropertyDeclaration(member) ? member.type?.getText() : undefined
                    }))
                });
            } else if (ts.isFunctionDeclaration(node)) {
                typeInfo.functions.push({
                    name: node.name?.text || 'Anonymous',
                    parameters: node.parameters.map(param => ({
                        name: param.name.getText(),
                        type: param.type?.getText()
                    })),
                    returnType: node.type?.getText()
                });
            }
            ts.forEachChild(node, visit);
        }

        visit(sourceFile);
        return JSON.stringify(typeInfo, null, 2);
    }
    
    private async storeEnhancedContext(
        filepath: string,
        content: string,
        embedding: Float32Array,
        metrics: CodeMetrics,
        gitMetadata: GitMetadata,
        typeInfo: string
    ) {
        const metadata = {
            timestamp: new Date().toISOString(),
            fileType: path.extname(filepath)
        };

        this.db.run(
            `INSERT INTO context_entries (
                file_path,
                content,
                metadata,
                embedding,
                complexity_metrics,
                git_metadata,
                type_info
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                filepath,
                content,
                JSON.stringify(metadata),
                Buffer.from(embedding.buffer),
                JSON.stringify(metrics),
                JSON.stringify(gitMetadata),
                typeInfo
            ],
            (err) => {
                if (err) console.error('Error storing enhanced context:', err);
            }
        );
    }
    
    private async showContextPanel() {
        const panel = vscode.window.createWebviewPanel(
            'contextView',
            'Context History',
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );
        
        this.db.all(
            `SELECT 
                c.*,
                GROUP_CONCAT(DISTINCT r.relationship_type) as relationships,
                cl.cluster_name
            FROM context_entries c
            LEFT JOIN relationships r ON c.id = r.source_id
            LEFT JOIN code_clusters cl ON cl.files LIKE '%' || c.file_path || '%'
            GROUP BY c.id
            ORDER BY c.timestamp DESC
            LIMIT 10`,
            [],
            (err, rows) => {
                if (err) {
                    console.error('Error fetching context:', err);
                    return;
                }
                
                panel.webview.html = this.getEnhancedWebviewContent(rows);
            }
        );
    }
    
    private getEnhancedWebviewContent(entries: any[]): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .entry {
                        margin-bottom: 20px;
                        padding: 10px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .metadata {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 10px;
                        margin: 10px 0;
                        font-size: 0.9em;
                    }
                    .metrics {
                        background: var(--vscode-editor-background);
                        padding: 8px;
                        border-radius: 4px;
                    }
                    .relationships {
                        color: var(--vscode-textLink-foreground);
                    }
                </style>
            </head>
            <body>
                <h1>Enhanced Context History</h1>
                ${entries.map(entry => {
                    const metrics = JSON.parse(entry.complexity_metrics || '{}');
                    const gitData = JSON.parse(entry.git_metadata || '{}');
                    return `
                        <div class="entry">
                            <h3>${entry.file_path}</h3>
                            <div class="metadata">
                                <div>
                                    <strong>Last Modified:</strong><br>
                                    ${new Date(entry.timestamp).toLocaleString()}
                                </div>
                                <div>
                                    <strong>Git Info:</strong><br>
                                    ${gitData.author || 'N/A'} on ${gitData.branch || 'N/A'}
                                </div>
                                <div>
                                    <strong>Complexity:</strong><br>
                                    ${metrics.complexity || 'N/A'}
                                </div>
                            </div>
                            <div class="metrics">
                                <strong>Dependencies:</strong><br>
                                ${(metrics.dependencies || []).join(', ') || 'None'}
                            </div>
                            ${entry.relationships ? `
                                <div class="relationships">
                                    <strong>Relationships:</strong><br>
                                    ${entry.relationships}
                                </div>
                            ` : ''}
                            <pre class="content">${this.escapeHtml(entry.content.substring(0, 500))}...</pre>
                        </div>
                    `;
                }).join('')}
            </body>
            </html>
        `;
    }
    
    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    private clearContext() {
        this.db.run(`DELETE FROM context_entries`, [], (err) => {
            if (err) {
                vscode.window.showErrorMessage('Failed to clear context history');
            } else {
                vscode.window.showInformationMessage('Context history cleared');
            }
        });
    }
    
    private registerViews() {
        // Register tree data provider
        vscode.window.registerTreeDataProvider(
            'cursor-context-history',
            this.treeDataProvider
        );

        // Register code insights provider
        vscode.window.registerTreeDataProvider(
            'cursor-context-insights',
            new CodeInsightsProvider(this)
        );
    }

    public async getRecentEntries(): Promise<ContextEntry[]> {
        return new Promise((resolve, reject) => {
            this.db.all<ContextRow>(
                `SELECT 
                    c.*,
                    GROUP_CONCAT(DISTINCT r.relationship_type) as relationships,
                    cl.cluster_name
                FROM context_entries c
                LEFT JOIN relationships r ON c.id = r.source_id
                LEFT JOIN code_clusters cl ON cl.files LIKE '%' || c.file_path || '%'
                GROUP BY c.id
                ORDER BY c.timestamp DESC
                LIMIT 10`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    const entries = rows.map(row => {
                        const metrics = JSON.parse(row.complexity_metrics || '{}');
                        const gitData = JSON.parse(row.git_metadata || '{}');
                        
                        return new ContextEntry(
                            path.basename(row.file_path),
                            vscode.TreeItemCollapsibleState.Collapsed,
                            {
                                command: 'cursor-context.showContextDetails',
                                title: 'Show Details',
                                arguments: [row]
                            }
                        );
                    });
                    
                    resolve(entries);
                }
            );
        });
    }

    private async showContextDetails(entry: any) {
        const panel = vscode.window.createWebviewPanel(
            'contextDetails',
            `Context: ${entry.file_path}`,
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );

        const metrics = JSON.parse(entry.complexity_metrics || '{}');
        const gitData = JSON.parse(entry.git_metadata || '{}');

        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .section {
                        margin-bottom: 20px;
                        padding: 10px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 10px;
                    }
                    .metric {
                        background: var(--vscode-editor-background);
                        padding: 8px;
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <h1>${entry.file_path}</h1>
                
                <div class="section">
                    <h2>Git Information</h2>
                    <div class="grid">
                        <div class="metric">
                            <strong>Author:</strong><br>
                            ${gitData.author || 'N/A'}
                        </div>
                        <div class="metric">
                            <strong>Branch:</strong><br>
                            ${gitData.branch || 'N/A'}
                        </div>
                        <div class="metric">
                            <strong>Last Commit:</strong><br>
                            ${gitData.commitMessage || 'N/A'}
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>Code Metrics</h2>
                    <div class="grid">
                        <div class="metric">
                            <strong>Complexity:</strong><br>
                            ${metrics.complexity || 'N/A'}
                        </div>
                        <div class="metric">
                            <strong>SLOC:</strong><br>
                            ${metrics.sloc || 'N/A'}
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>Dependencies</h2>
                    <div class="metric">
                        ${(metrics.dependencies || []).join('<br>') || 'None'}
                    </div>
                </div>

                ${entry.relationships ? `
                    <div class="section">
                        <h2>Relationships</h2>
                        <div class="metric">
                            ${entry.relationships}
                        </div>
                    </div>
                ` : ''}
            </body>
            </html>
        `;
    }
    
    private async searchContext(query: string) {
        try {
            // Generate query embedding
            const queryEmbedding = await this.generateEmbedding(query);
            
            // Get all context entries
            const entries = await this.getAllContextEntries();
            
            // Calculate similarity scores
            const results = entries.map(entry => {
                const similarity = this.calculateCosineSimilarity(
                    queryEmbedding,
                    new Float32Array(entry.embedding)
                );
                return { ...entry, similarity };
            });
            
            // Sort by similarity and show results
            results.sort((a, b) => b.similarity - a.similarity);
            this.showSearchResults(results.slice(0, 5));
        } catch (error) {
            console.error('Error searching context:', error);
            vscode.window.showErrorMessage('Error searching context');
        }
    }

    private async getAllContextEntries(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM context_entries WHERE embedding IS NOT NULL`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(rows);
                }
            );
        });
    }

    private calculateCosineSimilarity(a: Float32Array, b: Float32Array): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private showSearchResults(results: any[]) {
        const panel = vscode.window.createWebviewPanel(
            'searchResults',
            'Search Results',
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );

        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .result {
                        margin-bottom: 20px;
                        padding: 10px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .similarity {
                        color: var(--vscode-textLink-foreground);
                        font-size: 0.9em;
                    }
                    .preview {
                        margin-top: 10px;
                        padding: 8px;
                        background: var(--vscode-editor-background);
                        border-radius: 4px;
                        font-family: var(--vscode-editor-font-family);
                    }
                </style>
            </head>
            <body>
                <h1>Search Results</h1>
                ${results.map(result => `
                    <div class="result">
                        <h3>${result.file_path}</h3>
                        <div class="similarity">
                            Similarity: ${(result.similarity * 100).toFixed(2)}%
                        </div>
                        <div class="preview">
                            ${this.escapeHtml(result.content.substring(0, 200))}...
                        </div>
                    </div>
                `).join('')}
            </body>
            </html>
        `;
    }

    dispose() {
        this.watcher.close();
        this.db.close();
    }
}

export function activate(context: vscode.ExtensionContext) {
    const contextManager = new ContextManager(context);
    context.subscriptions.push({ dispose: () => contextManager.dispose() });
}

export function deactivate() {}