"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// src/extension.ts
const vscode = __importStar(require("vscode"));
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const chokidar = __importStar(require("chokidar"));
const tf = __importStar(require("@tensorflow/tfjs-node"));
const simple_git_1 = require("simple-git");
const node_nlp_1 = require("node-nlp");
const esprima = __importStar(require("esprima"));
const cr = __importStar(require("complexity-report"));
const tf_idf_search_1 = require("tf-idf-search");
const ts = __importStar(require("typescript"));
class ContextTreeDataProvider {
    constructor(contextManager) {
        this.contextManager = contextManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element) {
            return [];
        }
        else {
            return this.contextManager.getRecentEntries();
        }
    }
}
class ContextEntry extends vscode.TreeItem {
    constructor(label, collapsibleState, command) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.command = command;
    }
}
class CodeInsightsProvider {
    constructor(contextManager) {
        this.contextManager = contextManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element) {
            return this.getInsightDetails(element);
        }
        return this.getTopLevelInsights();
    }
    async getTopLevelInsights() {
        const insights = [
            new InsightItem('Complexity Hotspots', vscode.TreeItemCollapsibleState.Collapsed, 'complexity'),
            new InsightItem('Dependency Analysis', vscode.TreeItemCollapsibleState.Collapsed, 'dependencies'),
            new InsightItem('Recent Changes', vscode.TreeItemCollapsibleState.Collapsed, 'changes')
        ];
        return insights;
    }
    async getInsightDetails(item) {
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
    async getComplexityHotspots() {
        return new Promise((resolve, reject) => {
            this.contextManager.db.all(`SELECT file_path, complexity_metrics
                FROM context_entries
                WHERE complexity_metrics IS NOT NULL
                ORDER BY json_extract(complexity_metrics, '$.complexity') DESC
                LIMIT 5`, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                const items = rows.map(row => {
                    const metrics = JSON.parse(row.complexity_metrics);
                    return new InsightItem(`${path.basename(row.file_path)} (Complexity: ${metrics.complexity})`, vscode.TreeItemCollapsibleState.None, 'file', {
                        command: 'vscode.open',
                        title: 'Open File',
                        arguments: [vscode.Uri.file(row.file_path)]
                    });
                });
                resolve(items);
            });
        });
    }
    async getDependencyInsights() {
        return new Promise((resolve, reject) => {
            this.contextManager.db.all(`SELECT file_path, complexity_metrics
                FROM context_entries
                WHERE complexity_metrics IS NOT NULL`, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                const dependencyMap = new Map();
                rows.forEach(row => {
                    const metrics = JSON.parse(row.complexity_metrics);
                    metrics.dependencies.forEach((dep) => {
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
                    return new InsightItem(`${dep} (Used in ${files.size} files)`, vscode.TreeItemCollapsibleState.None, 'dependency');
                });
                resolve(items);
            });
        });
    }
    async getRecentChanges() {
        return new Promise((resolve, reject) => {
            this.contextManager.db.all(`SELECT file_path, git_metadata
                FROM context_entries
                WHERE git_metadata IS NOT NULL
                ORDER BY json_extract(git_metadata, '$.timestamp') DESC
                LIMIT 5`, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                const items = rows.map(row => {
                    const gitData = JSON.parse(row.git_metadata);
                    return new InsightItem(`${path.basename(row.file_path)} (${gitData.author})`, vscode.TreeItemCollapsibleState.None, 'file', {
                        command: 'vscode.open',
                        title: 'Open File',
                        arguments: [vscode.Uri.file(row.file_path)]
                    });
                });
                resolve(items);
            });
        });
    }
}
class InsightItem extends vscode.TreeItem {
    constructor(label, collapsibleState, contextValue, command) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.contextValue = contextValue;
        this.command = command;
        this.tooltip = this.label;
        this.iconPath = this.getIcon();
    }
    getIcon() {
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
    constructor(context) {
        this.context = context;
        // Initialize components
        const dbPath = path.join(context.globalStoragePath, 'context.db');
        this.db = new sqlite3.Database(dbPath);
        this.git = (0, simple_git_1.simpleGit)();
        this.nlpManager = new node_nlp_1.NlpManager({ languages: ['en'] });
        this.tfidf = new tf_idf_search_1.TfIdf();
        this.embeddings = new Map();
        // Initialize tree data provider
        this.treeDataProvider = new ContextTreeDataProvider(this);
        // Initialize status bar
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        // Initialize file watcher with improved settings
        this.watcher = chokidar.watch('', {
            ignored: [/(^|[\/\\])\../, 'node_modules', 'out', 'dist'],
            persistent: true,
            ignoreInitial: false,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            }
        });
        this.setup();
    }
    async setup() {
        await this.initDatabase();
        this.setupStatusBar();
        this.setupWatcher();
        this.registerCommands();
        this.registerViews();
        this.model = await this.initializeEmbeddingModel();
    }
    async initDatabase() {
        return new Promise((resolve, reject) => {
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
                `, function (err) {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        });
    }
    setupStatusBar() {
        this.statusBar.text = "$(database) Context";
        this.statusBar.tooltip = "Show Context History";
        this.statusBar.command = 'cursor-context.showContext';
        this.statusBar.show();
    }
    setupWatcher() {
        if (vscode.workspace.workspaceFolders) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.watcher.add(workspaceRoot);
            this.watcher.on('change', async (filepath) => {
                try {
                    const doc = await vscode.workspace.openTextDocument(filepath);
                    await this.processFile(filepath, doc.getText());
                }
                catch (error) {
                    console.error('Error processing file change:', error);
                }
            });
        }
    }
    registerCommands() {
        // Show context command
        this.context.subscriptions.push(vscode.commands.registerCommand('cursor-context.showContext', () => {
            this.showContextPanel();
        }));
        // Clear context command
        this.context.subscriptions.push(vscode.commands.registerCommand('cursor-context.clearContext', () => {
            this.clearContext();
        }));
        // Show context details command
        this.context.subscriptions.push(vscode.commands.registerCommand('cursor-context.showContextDetails', (entry) => {
            this.showContextDetails(entry);
        }));
        // Search context command
        this.context.subscriptions.push(vscode.commands.registerCommand('cursor-context.searchContext', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Enter search query',
                placeHolder: 'Search in context history...'
            });
            if (query) {
                await this.searchContext(query);
            }
        }));
    }
    async processFile(filepath, content) {
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
        }
        catch (error) {
            console.error('Error processing file:', error);
        }
    }
    async initializeEmbeddingModel() {
        await tf.ready();
        // Load Universal Sentence Encoder
        const model = await tf.loadGraphModel('https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1', { fromTFHub: true });
        return model;
    }
    async generateEmbedding(content) {
        try {
            // Split content into chunks to handle large files
            const chunks = this.splitIntoChunks(content);
            const embeddings = [];
            for (const chunk of chunks) {
                // Convert text to tensor
                const input = tf.tensor2d([chunk]);
                // Generate embedding
                const embedding = await this.model.predict(input);
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
        }
        catch (error) {
            console.error('Error generating embedding:', error);
            // Fallback to simple hash-based embedding
            return this.generateSimpleEmbedding(content);
        }
    }
    generateSimpleEmbedding(content) {
        const words = content.toLowerCase().split(/\W+/);
        const embedding = new Float32Array(512).fill(0);
        words.forEach((word, i) => {
            const hash = this.simpleHash(word);
            embedding[hash % 512] += 1;
        });
        return embedding;
    }
    splitIntoChunks(content) {
        const maxChunkSize = 500; // Maximum words per chunk
        const words = content.split(/\s+/);
        const chunks = [];
        for (let i = 0; i < words.length; i += maxChunkSize) {
            chunks.push(words.slice(i, i + maxChunkSize).join(' '));
        }
        return chunks;
    }
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
    analyzeCodeMetrics(content, filepath) {
        let complexity = 0;
        let dependencies = [];
        try {
            if (filepath.endsWith('.ts') || filepath.endsWith('.js')) {
                const ast = esprima.parseModule(content);
                const report = cr.run(content, {
                    forms: true,
                    streams: false,
                    dependencies: true
                });
                complexity = report.aggregate.cyclomatic;
                dependencies = report.dependencies.map(d => d.path);
            }
        }
        catch (error) {
            console.error('Error analyzing code metrics:', error);
        }
        return {
            complexity,
            sloc: content.split('\n').length,
            dependencies,
            typeInfo: ''
        };
    }
    async getGitMetadata(filepath) {
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
        }
        catch (error) {
            console.error('Error getting git metadata:', error);
            return {
                lastCommit: '',
                author: '',
                commitMessage: '',
                branch: ''
            };
        }
    }
    extractTypeInfo(content, filepath) {
        if (!filepath.endsWith('.ts') && !filepath.endsWith('.tsx')) {
            return '';
        }
        const sourceFile = ts.createSourceFile(filepath, content, ts.ScriptTarget.Latest, true);
        const typeInfo = {
            interfaces: [],
            types: [],
            classes: [],
            functions: []
        };
        function visit(node) {
            if (ts.isInterfaceDeclaration(node)) {
                typeInfo.interfaces.push({
                    name: node.name.text,
                    members: node.members.map(member => ({
                        name: member.name?.getText(),
                        type: ts.isPropertySignature(member) ? member.type?.getText() : undefined
                    }))
                });
            }
            else if (ts.isTypeAliasDeclaration(node)) {
                typeInfo.types.push({
                    name: node.name.text,
                    type: node.type.getText()
                });
            }
            else if (ts.isClassDeclaration(node)) {
                typeInfo.classes.push({
                    name: node.name?.text || 'Anonymous',
                    members: node.members.map(member => ({
                        name: member.name?.getText(),
                        type: ts.isPropertyDeclaration(member) ? member.type?.getText() : undefined
                    }))
                });
            }
            else if (ts.isFunctionDeclaration(node)) {
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
    async storeEnhancedContext(filepath, content, embedding, metrics, gitMetadata, typeInfo) {
        const metadata = {
            timestamp: new Date().toISOString(),
            fileType: path.extname(filepath)
        };
        this.db.run(`INSERT INTO context_entries (
                file_path,
                content,
                metadata,
                embedding,
                complexity_metrics,
                git_metadata,
                type_info
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            filepath,
            content,
            JSON.stringify(metadata),
            Buffer.from(embedding.buffer),
            JSON.stringify(metrics),
            JSON.stringify(gitMetadata),
            typeInfo
        ], (err) => {
            if (err)
                console.error('Error storing enhanced context:', err);
        });
    }
    async showContextPanel() {
        const panel = vscode.window.createWebviewPanel('contextView', 'Context History', vscode.ViewColumn.Two, { enableScripts: true });
        this.db.all(`SELECT 
                c.*,
                GROUP_CONCAT(DISTINCT r.relationship_type) as relationships,
                cl.cluster_name
            FROM context_entries c
            LEFT JOIN relationships r ON c.id = r.source_id
            LEFT JOIN code_clusters cl ON cl.files LIKE '%' || c.file_path || '%'
            GROUP BY c.id
            ORDER BY c.timestamp DESC
            LIMIT 10`, [], (err, rows) => {
            if (err) {
                console.error('Error fetching context:', err);
                return;
            }
            panel.webview.html = this.getEnhancedWebviewContent(rows);
        });
    }
    getEnhancedWebviewContent(entries) {
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
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    clearContext() {
        this.db.run(`DELETE FROM context_entries`, [], (err) => {
            if (err) {
                vscode.window.showErrorMessage('Failed to clear context history');
            }
            else {
                vscode.window.showInformationMessage('Context history cleared');
            }
        });
    }
    registerViews() {
        // Register tree data provider
        vscode.window.registerTreeDataProvider('cursor-context-history', this.treeDataProvider);
        // Register code insights provider
        vscode.window.registerTreeDataProvider('cursor-context-insights', new CodeInsightsProvider(this));
    }
    async getRecentEntries() {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT 
                    c.*,
                    GROUP_CONCAT(DISTINCT r.relationship_type) as relationships,
                    cl.cluster_name
                FROM context_entries c
                LEFT JOIN relationships r ON c.id = r.source_id
                LEFT JOIN code_clusters cl ON cl.files LIKE '%' || c.file_path || '%'
                GROUP BY c.id
                ORDER BY c.timestamp DESC
                LIMIT 10`, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                const entries = rows.map(row => {
                    const metrics = JSON.parse(row.complexity_metrics || '{}');
                    const gitData = JSON.parse(row.git_metadata || '{}');
                    return new ContextEntry(path.basename(row.file_path), vscode.TreeItemCollapsibleState.Collapsed, {
                        command: 'cursor-context.showContextDetails',
                        title: 'Show Details',
                        arguments: [row]
                    });
                });
                resolve(entries);
            });
        });
    }
    async showContextDetails(entry) {
        const panel = vscode.window.createWebviewPanel('contextDetails', `Context: ${entry.file_path}`, vscode.ViewColumn.Two, { enableScripts: true });
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
    async searchContext(query) {
        try {
            // Generate query embedding
            const queryEmbedding = await this.generateEmbedding(query);
            // Get all context entries
            const entries = await this.getAllContextEntries();
            // Calculate similarity scores
            const results = entries.map(entry => {
                const similarity = this.calculateCosineSimilarity(queryEmbedding, new Float32Array(entry.embedding));
                return { ...entry, similarity };
            });
            // Sort by similarity and show results
            results.sort((a, b) => b.similarity - a.similarity);
            this.showSearchResults(results.slice(0, 5));
        }
        catch (error) {
            console.error('Error searching context:', error);
            vscode.window.showErrorMessage('Error searching context');
        }
    }
    async getAllContextEntries() {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT * FROM context_entries WHERE embedding IS NOT NULL`, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }
    calculateCosineSimilarity(a, b) {
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
    showSearchResults(results) {
        const panel = vscode.window.createWebviewPanel('searchResults', 'Search Results', vscode.ViewColumn.Two, { enableScripts: true });
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
function activate(context) {
    const contextManager = new ContextManager(context);
    context.subscriptions.push({ dispose: () => contextManager.dispose() });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map