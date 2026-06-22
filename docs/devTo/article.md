# Building a 100% Local AI-Powered Document Search Engine with ask-doc CLI

## Table of Contents

1. [Introduction](#introduction)
2. [The Problem: Local Data Privacy](#the-problem-local-data-privacy)
3. [What is ask-doc CLI](#what-is-ask-doc-cli)
4. [Architecture Overview](#architecture-overview)
5. [Getting Started](#getting-started)
6. [Core Features in Depth](#core-features-in-depth)
7. [Practical Usage Examples](#practical-usage-examples)
8. [Benefits and Trade-offs](#benefits-and-trade-offs)
9. [Roadmap and Future Capabilities](#roadmap-and-future-capabilities)
10. [When to Use ask-doc](#when-to-use-ask-doc)
11. [Conclusion](#conclusion)

---

## Introduction

Document management and search have become critical in modern development workflows. However, most solutions require sending your data to cloud services. If you work with sensitive documents, proprietary code, or simply prefer to keep everything local, you face a difficult choice: compromise on search capabilities or accept the privacy trade-off.

`ask-doc` changes this equation. It is a command-line tool that brings powerful hybrid search (combining keyword and semantic search) entirely to your local machine, without any cloud dependencies.

This article walks you through how ask-doc works, how to set it up, and when it's the right tool for your workflow.

---

## The Problem: Local Data Privacy

### Why Local Matters

When you ingest documents into cloud-based systems:

- Your data leaves your control
- Third-party services may retain copies
- Compliance requirements (HIPAA, GDPR) may forbid this
- Network latency affects search speed
- Cost scales with document volume

For teams handling:

- Healthcare records or patient information
- Legal documents and contracts
- Proprietary code and technical specifications
- Financial data or trade secrets
- Classified or regulated content

...keeping everything on-disk is not optional, it is required.

### The Trade-off

Local-first tools historically sacrifice search quality. Keyword search (BM25) is fast but misses semantic meaning. Full semantic search requires large language models that demand significant computational resources.

ask-doc solves this by combining both approaches locally: BM25 for fast keyword matching and local embeddings for semantic understanding, all without external API calls.

---

## What is ask-doc CLI

`ask-doc` is a Node.js and TypeScript CLI application designed for:

1. Ingesting multiple document formats (markdown, PDF, Word, Excel, images with OCR)
2. Processing documents into optimized chunks
3. Generating embeddings locally using Hugging Face transformers and ONNX runtime
4. Building dual indices: BM25 for keyword search and vector embeddings for semantic search
5. Storing everything in LanceDB, a high-performance local vector database

All of this happens on your machine. No network calls. No API keys. No cloud dependencies.

### Key Capabilities

Local Embeddings: Runs on-device ML models via @huggingface/transformers and ONNX runtime

Hybrid Search Ready: Prepares documents for both sparse (BM25) and dense (vector) retrieval

Multi-format Support: Handles .md, .txt, .pdf, .docx, .xlsx, and images (via Tesseract OCR)

Dynamic Configuration: Adjust models, chunk sizes, and pipeline behavior without code changes

Persistent Storage: All indices and vectors stored locally in LanceDB

---

## Architecture Overview

### High-level Flow

```
User Command
    |
    v
Commander.js Router
    |
    +---> Ingest Pipeline          +---> Config Management
    |     |                         |
    |     +-- File Walker           |     +-- config.json
    |     |   (discover files)      |
    |     |                         |
    |     +-- Document Parsers      |
    |     |   (extract text)        |
    |     |                         |
    |     +-- Text Chunker          |
    |     |   (split into segments) |
    |     |                         |
    |     +-- BM25 Service          |
    |     |   (keyword indexing)    |
    |     |                         |
    |     +-- Embedding Service     |
    |     |   (generate vectors)    |
    |     |   |                     |
    |     |   +-- Worker Pool       |
    |     |   +-- Transformers      |
    |     |   +-- ONNX Model        |
    |     |                         |
    |     +-- Storage Service       |
    |         (persist indices)     |
    |         |                     |
    |         +-- LanceDB (local)   |
    |         +-- BM25 Index        |
```

### Why This Architecture

Separation of concerns: Each service (chunking, embedding, storage) handles one responsibility

Offline-first: All ML operations use local models; no network required

Scalability: Worker pools prevent memory saturation when processing large batches

Flexibility: Configuration-driven behavior allows tuning without recompilation

---

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- 4GB+ available disk space (for models and vector index)

### Installation

Clone and install:

```bash
git clone https://github.com/kamalsoft/transformer-embedding.git
cd transformer-embedding
npm install
```

Build the project:

```bash
npm run build
```

Optionally link globally for system-wide CLI access:

```bash
npm link
```

If you skip this step, use `npx ask-doc` instead of `ask-doc` in subsequent commands.

### Download Pre-trained Models

Before running ingestion, download the embedding model:

```bash
npm run download-models
```

This fetches the `Xenova/all-MiniLM-L6-v2` model (a lightweight, fast embedding model) and places it in `./model/embeddings/`. The model is approximately 50MB and runs efficiently on standard hardware.

Check model configuration:

```bash
ask-doc config get models
```

Expected output shows the active model and its metadata.

### Verify Installation

Test that the CLI is operational:

```bash
ask-doc --help
```

You should see available commands: `ingest`, `config`, and scripts.

---

## Core Features in Depth

### 1. Multi-Format Document Ingestion

ask-doc processes diverse document types through specialized parsers:

Text and Markdown (.md, .txt)
Parsed directly; preserves structure

PDF (.pdf)
Extracts text while handling multi-page layouts

Microsoft Office (.docx, .xlsx)
Extracts text from document content and cells

Images (via Tesseract OCR)
Detects and extracts text from image files locally using Tesseract.js

All extracted content flows through the same chunking and embedding pipeline, making formats interchangeable from a search perspective.

Example: Images containing handwritten notes, PDFs with scanned content, and Word documents with tables are all indexed identically.

### 2. Intelligent Text Chunking

Documents are split into overlapping segments. Configuration drives this process:

```json
{
  "ingestion": {
    "chunk_size": 512,
    "chunk_overlap": 50
  }
}
```

chunk_size: Characters per segment (default 512). Smaller chunks improve retrieval precision; larger chunks provide more context.

chunk_overlap: Characters of overlap between segments. Prevents cutting sentences mid-thought.

Example: A 10,000-character document with chunk_size=512 and chunk_overlap=50 produces roughly 20 chunks, with each overlapping 50 characters with neighbors.

This approach balances retrieval granularity with context preservation.

### 3. Local Embedding Generation

The EmbeddingService loads a Hugging Face transformer model via ONNX runtime and generates dense vector representations for every chunk.

How it works:

1. Load model from ./model/ directory
2. Tokenize chunk text
3. Run inference on ONNX runtime
4. Generate 384-dimensional embedding vectors (for all-MiniLM-L6-v2)
5. Return embedding for storage

Performance: Modern hardware processes embeddings at roughly 100-500 chunks per second, depending on hardware.

This happens entirely offline. No data leaves your machine.

### 4. BM25 Indexing for Keyword Search

Alongside embeddings, ask-doc builds a BM25 sparse index. BM25 is a probabilistic ranking function that excels at keyword-based retrieval.

Why both BM25 and embeddings?

BM25 excels at exact and near-exact matches. Searching "Python decorator" returns documents containing these terms, ranked by relevance.

Embeddings excel at semantic matching. Searching "how do I add functionality to a function" returns semantically similar results even without exact keyword matches.

Together, they form a hybrid retrieval system: BM25 handles precise queries, embeddings handle fuzzy intent.

### 5. Persistent Storage in LanceDB

All vectors and metadata are persisted in LanceDB, a columnar vector database optimized for search.

Advantages:

Sub-millisecond vector search (via SIMD optimizations)
Minimal memory footprint
Transactional writes
Native support for metadata filtering

Storage structure:

```
vector-store/
  embeddings.lance          # Vector embeddings
  metadata.json             # Chunk metadata (source file, offset, etc.)
  bm25_index.db             # BM25 index
```

---

## Practical Usage Examples

### Example 1: Ingest a Directory of Technical Documentation

```bash
ask-doc ingest --path ./my-docs
```

This recursively scans ./my-docs, discovers all supported file formats, chunks them, generates embeddings, and stores everything in LanceDB.

Output shows progress: files detected, chunks created, embeddings generated.

### Example 2: Ingest Only PDF Files

```bash
ask-doc ingest --path ./research-papers --filetype .pdf
```

Filters ingestion to .pdf files only, useful when you have mixed directories.

### Example 3: Adjust Chunking Configuration

Before ingestion, customize chunk size for more granular retrieval:

```bash
ask-doc config set ingestion --key chunk_size --value 256
```

Smaller chunks improve precision for short, specific queries. Larger chunks preserve document context.

### Example 4: View Current Configuration

```bash
ask-doc config get ingestion
```

Expected output:

```json
{
  "chunk_size": 256,
  "chunk_overlap": 50
}
```

### Example 5: Switch Embedding Models

ask-doc supports multiple pre-trained models. To use a different model:

```bash
ask-doc config set models --key model_name --value Xenova/all-MiniLM-L12-v2
npm run download-models
```

Then re-ingest your documents with the new model. Different models offer trade-offs between speed and accuracy.

---

## Benefits and Trade-offs

### Benefits

Complete Data Privacy
No cloud calls; all processing local. Compliance-friendly.

Offline-First Workflow
Works without internet connectivity.

Cost Efficiency
No per-document or per-query API charges. One-time computation.

Customization
Control over models, chunking strategy, and storage without vendor lock-in.

Speed
Local vector search operates at sub-millisecond latency once indexed.

### Trade-offs

Initial Computational Cost
Embedding generation requires CPU/GPU; scales with document volume. A 1GB document collection may take 10-30 minutes on standard hardware.

Model Download Size
Embedding models are 50-300MB depending on quality/speed trade-off.

Limited to Local Hardware
Resource constraints (RAM, disk space) directly impact performance. Cloud systems can scale independently.

Manual Model Management
You manage model versioning and updates; no automatic updates.

Development Stage
ask-doc is actively developed. The query and LLM integration features are in the roadmap but not yet released.

---

## Roadmap and Future Capabilities

### Phase 1: Search and Hybrid Retrieval (Short-term)

query Command: Hybrid search endpoint combining BM25 and vector similarity with reranking

Metadata Filtering: Filter results by source file, creation date, or custom tags

Index Integrity: Automatic validation and repair of corrupted indices

### Phase 2: Local Intelligence (Mid-term)

Local LLM Integration: Chain embeddings with local LLMs (Ollama, Llama 3) for natural language answers

Reranking: Implement local Cross-Encoder models to refine retrieval results

Semantic Chunking: Move beyond fixed-size splits to context-aware document segmentation

### Phase 3: Scaling and Ecosystem (Long-term)

Desktop GUI: Cross-platform visual interface for non-CLI users

API Mode: Expose ask-doc as a headless REST API for integration with other tools

---

## When to Use ask-doc

ask-doc is the right choice when:

You work with sensitive or regulated documents (HIPAA, GDPR compliance required)

You prefer to avoid cloud dependencies and third-party API calls

You need semantic search but cannot afford cloud LLM costs

You want to customize the embedding model and chunking strategy

You have a local development or research workflow

ask-doc is not ideal if:

You require real-time collaboration across teams (no distributed sync)

You need advanced NLP features (reranking, answer generation) today

You process terabytes of data and require horizontal scaling

You are unfamiliar with the command line

---

## Conclusion

ask-doc brings the power of hybrid semantic and keyword search to your local machine, without sacrificing privacy or flexibility. By combining Hugging Face transformers, ONNX runtime, LanceDB, and pragmatic architecture, it makes local-first AI-powered document search accessible to developers and teams.

Whether you're managing research papers, confidential code repositories, or proprietary documentation, ask-doc provides a lightweight, open-source foundation for building intelligent local search systems.

### Next Steps

Clone the repository: https://github.com/kamalsoft/transformer-embedding

Follow the Getting Started guide

Index your first document collection

Monitor the roadmap for upcoming query and LLM integration features

Join the community and contribute

Ask questions in issues or discussions

### References and Resources

Hugging Face Transformers: https://huggingface.co/docs/transformers

LanceDB Documentation: https://lancedb.com/docs

ONNX Runtime: https://onnxruntime.ai/

BM25 Algorithm: https://en.wikipedia.org/wiki/Okapi_BM25

Tesseract OCR: https://github.com/tesseract-ocr/tesseract

Commander.js CLI Framework: https://github.com/tj/commander.js

---

**Image Placeholders (to be added):**

[INSERT: Architecture diagram showing data flow from user input through CLI router to storage]

[INSERT: Screenshot of ask-doc ingest command executing on terminal]

[INSERT: Performance comparison chart: embedding speed vs model size]

[INSERT: File format support matrix table]

[INSERT: LanceDB storage structure visualization]

[INSERT: Example config.json with annotations]

---

**Article Metadata for dev.to:**

Title: Building a 100% Local AI-Powered Document Search Engine with ask-doc CLI

Tags: #devops #nodejs #typescript #ai #localdevelopment #privacy #cli

Cover Image: [Ask-doc CLI screenshot or architecture diagram]

Published: [Date]

Updated: [Date]

Reading Time: 12 minutes

---

*This article is part of the ask-doc documentation series. For the complete API reference and advanced configuration, see the project README.*