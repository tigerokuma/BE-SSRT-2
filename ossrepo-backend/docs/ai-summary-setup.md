# AI Repository Summary Setup Guide

This guide explains how to set up the AI-powered repository summary feature using a local Mistral model via Ollama.

## Overview

The AI summary feature generates concise, informative summaries of repositories when they're added to the watchlist. It uses a local Mistral 7B model to avoid API costs and ensure privacy.

## Prerequisites

- Node.js 18+ 
- Git Bash (recommended for Windows users)
- At least 8GB RAM (16GB recommended for optimal performance)
- 4GB free disk space for the model

## Installation Steps

### 1. Install Ollama

#### Windows (Git Bash)
```bash
# Download from: https://ollama.ai/download
# After installation, restart your terminal or add to PATH manually

# If ollama command not found, try the full path:
"C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe" --version

# Or add to PATH via command line:
setx PATH "%PATH%;C:\Users\%USERNAME%\AppData\Local\Programs\Ollama"

# Alternative: Install via winget
winget install Ollama.Ollama
```

#### macOS
```bash
# Using Homebrew
brew install ollama

# Or download from: https://ollama.ai/download
```

#### Linux
```bash
# Download and install Ollama
curl -fsSL https://ollama.ai/install.sh | sh
```

### 2. Start Ollama Service

```bash
# Start the Ollama service
ollama serve

# Keep this running in a separate terminal
```

### 3. Download Mistral Model

```bash
# Download the Mistral 7B Instruct model (about 4GB)
ollama pull mistral:7b-instruct

# Verify the model is available
ollama list
```

### 4. Test the Setup

```bash
# Test the model with a simple prompt
ollama run mistral:7b-instruct "Generate a one-sentence summary of this test."
```

## Configuration

The AI summary service is automatically configured when the application starts. It will:

1. Check if Ollama is installed and running
2. Verify the Mistral model is available
3. Download the model if it's not already present
4. Fall back to basic summaries if the model is unavailable

## Usage

### API Endpoint

Test the AI summary generation:

```bash
GET /activity/ai-summary/test?owner=facebook&repo=react
```

### Example Response

```json
{
  "success": true,
  "summary": {
    "text": "React is a popular JavaScript library for building user interfaces, maintained by Facebook with over 200k stars and active development by hundreds of contributors.",
    "confidence": 0.85,
    "model": "mistral:7b-instruct",
    "generatedAt": "2024-01-15T10:30:00.000Z"
  },
  "message": "✅ AI summary generated successfully for facebook/react"
}
```

## Integration with Repository Setup

When a repository is added to the watchlist, the AI summary service will:

1. Collect repository data (stars, forks, description, recent commits, etc.)
2. Calculate bus factor and risk metrics
3. Generate a concise 2-3 sentence summary
4. Store the summary with confidence score and metadata

## Troubleshooting

### Common Issues

1. **Ollama not found**
   - Ensure Ollama is installed and in your PATH
   - Restart your terminal after installation
   - **Windows**: Add Ollama to PATH manually or use full path
   - **Windows**: Try `"C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe" --version`

2. **Model download fails**
   - Check internet connection
   - Ensure sufficient disk space (4GB+)
   - Try downloading again: `ollama pull mistral:7b-instruct`

3. **Slow response times**
   - The model requires significant RAM (8GB+ recommended)
   - First generation may be slower as the model loads
   - Consider using a smaller model for faster responses

4. **Memory issues**
   - Close other applications to free up RAM
   - Consider using a smaller model variant

### Performance Optimization

- **Model Size**: The 7B model provides good quality but uses more resources
- **Batch Processing**: Multiple summaries can be processed in parallel
- **Caching**: Summaries are cached to avoid regeneration

## Fallback Behavior

If the AI model is unavailable, the system will:

1. Generate basic summaries using repository metadata
2. Log warnings about the missing AI capability
3. Continue normal operation without AI summaries

## Security Considerations

- All processing is done locally - no data sent to external APIs
- Model files are stored locally on your machine
- No internet connection required after initial model download

## Future Enhancements

- Support for additional models (Llama, CodeLlama, etc.)
- Custom model fine-tuning for repository summaries
- Batch processing for multiple repositories
- Integration with more repository data sources 