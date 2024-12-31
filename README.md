# Cursor Context Manager

Automated context management system for Cursor IDE that helps maintain and understand your codebase through semantic analysis, code metrics, and intelligent context tracking.

## Features

### 1. Automated Context Tracking
- Real-time file change monitoring
- Semantic code analysis
- Git metadata integration
- Type information extraction
- Dependency tracking

### 2. Semantic Search
- Vector-based code search
- TF-IDF weighted indexing
- Intelligent context matching
- Code similarity analysis

### 3. Code Insights
- Complexity hotspots detection
- Dependency analysis
- Recent changes tracking
- Type information overview

### 4. Knowledge Graph
- Component relationship mapping
- Code cluster identification
- Complexity visualization
- Cross-file dependencies

## Installation

1. Open Cursor IDE
2. Press `Ctrl+Shift+X` to open the Extensions view
3. Search for "Cursor Context Manager"
4. Click Install

## Usage

### Commands
Access these commands through the Command Palette (`Ctrl+Shift+P`):
- `Cursor: Show Current Context` - View context history
- `Cursor: Search Context` - Perform semantic search
- `Cursor: Clear Context History` - Clear stored context

### Views
Access these views through the Activity Bar:
1. **Context History**
   - View file changes
   - See git metadata
   - Track complexity metrics
   
2. **Code Insights**
   - Complexity hotspots
   - Dependency analysis
   - Recent changes

### Configuration
Configure the extension through Settings (`Ctrl+,`):
- `cursor-context.storageSize`: Maximum number of context entries to store
- `cursor-context.updateInterval`: Context update interval in seconds
- `cursor-context.embeddings.model`: Model to use for embeddings
- `cursor-context.git.enabled`: Enable Git metadata tracking
- `cursor-context.complexity.enabled`: Enable code complexity analysis

## Requirements
- Cursor IDE
- Git (for git metadata tracking)
- Node.js and npm (for development)

## Extension Settings

This extension contributes the following settings:

* `cursor-context.storageSize`: Maximum number of context entries to store (default: 100)
* `cursor-context.updateInterval`: Context update interval in seconds (default: 30)
* `cursor-context.embeddings.model`: Model to use for generating embeddings
* `cursor-context.git.enabled`: Enable Git metadata tracking
* `cursor-context.complexity.enabled`: Enable code complexity analysis

## Known Issues

- Large files may take longer to process due to embedding generation
- Git metadata tracking requires a git repository
- Some complex TypeScript types may not be fully analyzed

## Release Notes

### 0.0.1
- Initial release
- Basic context tracking
- Semantic search
- Code insights
- Git integration

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 