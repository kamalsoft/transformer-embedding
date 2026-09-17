# ask-doc CLI

`ask-doc` is a 100% local Command Line Interface (CLI) application built with Node.js and TypeScript. It is designed to ingest local documents, process them into chunks, and store them for hybrid search (combining BM25 sparse search and Vector embeddings) without ever sending data to the cloud.

## 🚀 Features

- **Local Embeddings:** Utilizes `@huggingface/transformers` (v4) and the ONNX runtime to generate embeddings locally.
- **Hybrid Search Ready:** Processes documents for both BM25 (sparse) and Vector (dense) search.
- **Multi-format & OCR Support:** Ingests `.md`, `.txt`, `.pdf`, `.docx`, `.xlsx`, and images using local OCR.
- **Dynamic Configuration:** Manage all runtime settings (models, paths, chunking) directly via the CLI.
- **Persistent Storage:** Utilizes **LanceDB** for high-performance, local vector storage.

## 📄 Supported File Formats

The CLI is capable of processing a variety of document types for local ingestion:

- **Text & Documentation:** `.md`, `.txt`
- **Portable Documents:** `.pdf`
- **Microsoft Office:** `.docx`, `.xlsx`
- **Images (via OCR):** Supports common image formats through the integrated Tesseract.js engine.

## 👁️ How OCR Integration Works

The project uses `Tesseract.js` for local text extraction from images. The process is fully offline:

1.  **Detection:** The `File Walker` identifies image files by extension.
2.  **Worker Lifecycle:** A local OCR worker is instantiated for each image.
3.  **Recognition:** The engine analyzes the image and returns structured text strings.
4.  **Memory Management:** Workers are terminated immediately after extraction to ensure low memory overhead.
5.  **Standardization:** Extracted text is sent to the `Chunker`, making image content searchable via the same vector/BM25 pipeline as text documents.


## 🏗️ Architecture

```mermaid
graph TD
    User([User]) --> CLI[ask-doc CLI]
    CLI --> CmdRouter{Commander.js}

    subgraph "Ingestion Engine"
        CmdRouter --> Ingest[Ingest Command]
        Ingest --> Walker[File Walker]
        Walker --> Docs[(Local Docs)]
        Ingest --> Parser[Document Parsers]
        Parser --> Chunker[Text Chunker]
        Chunker --> Embedder[Embedding Service]
        Embedder --> WorkerPool[Worker Pool]
        WorkerPool --> Transformers["@huggingface/transformers"]
        Transformers --> Model[(Local ONNX Model)]
        Chunker --> BM25[BM25 Service]
        Embedder --> Storage[Storage Service]
        BM25 --> Storage
        Storage --> VStore[(LanceDB - Local)]
    end

    subgraph "Configuration Management"
        CmdRouter --> Config[Config Command]
        Config --> ConfigFile[(config.json)]
    end
```

## Code flow
```mermaid
flowchart TD

subgraph group_cli["CLI surface"]
  node_node_cli{{"Node.js TypeScript CLI<br/>ESM runtime<br/>[index.ts]"}}
  node_node_commands["Operational commands<br/>command handlers"]
  node_node_download_command["Download models command<br/>CLI command<br/>[downloadModels.ts]"]
end

subgraph group_ingestion["Ingestion pipeline"]
  node_node_ingest["Ingest command<br/>pipeline orchestrator<br/>[ingest.ts]"]
  node_node_file_walker["File discovery<br/>filesystem boundary<br/>[fileWalker.ts]"]
  node_node_parsers["Format parsers and OCR<br/>document extraction<br/>[csvParser.ts]"]
  node_node_chunking["Chunking<br/>text segmentation"]
end

subgraph group_index["Local retrieval index"]
  node_node_bm25["BM25 indexer<br/>sparse retrieval<br/>[bm25.ts]"]
  node_node_storage["Storage abstraction<br/>index repository<br/>[storage.ts]"]
  node_node_lancedb[("LanceDB<br/>local vector persistence<br/>[lanceDbService.ts]")]
end

subgraph group_models["Local model runtime"]
  node_node_embedding["Embedding service<br/>dense vector generation<br/>[embedding.ts]"]
  node_node_embedding_worker["Embedding worker<br/>worker runtime"]
  node_node_model_manager["Model manager<br/>model lifecycle<br/>[modelManager.ts]"]
  node_node_model["ONNX embedding model<br/>model artifact<br/>[model.onnx]"]
  node_node_download_service["Model download service<br/>provisioning<br/>[downloadModels.ts]"]
end

subgraph group_agentic["Agentic extraction"]
  node_node_agentic_command["Agentic extract command<br/>CLI workflow<br/>[agenticExtract.ts]"]
  node_node_agentic_service["Agentic extraction service<br/>extraction workflow"]
  node_node_agentic_config["Agentic extraction config<br/>workflow settings"]
end

node_node_config["Runtime configuration<br/>settings<br/>[config.json]"]
node_node_config_utils["Config access<br/>configuration utility<br/>[config.ts]"]

node_node_cli -->|"routes"| node_node_commands
node_node_cli -->|"runs"| node_node_ingest
node_node_cli -->|"runs"| node_node_agentic_command
node_node_cli -->|"runs"| node_node_download_command
node_node_ingest -->|"discovers files"| node_node_file_walker
node_node_file_walker -->|"supplies files"| node_node_parsers
node_node_parsers -->|"extracts text"| node_node_chunking
node_node_chunking -->|"embeds chunks"| node_node_embedding
node_node_chunking -->|"indexes terms"| node_node_bm25
node_node_embedding -->|"runs in"| node_node_embedding_worker
node_node_embedding_worker -->|"loads through"| node_node_model_manager
node_node_model_manager -->|"manages"| node_node_model
node_node_embedding -->|"writes vectors"| node_node_storage
node_node_bm25 -->|"writes sparse data"| node_node_storage
node_node_storage -->|"implements"| node_node_lancedb
node_node_commands -->|"searches and administers"| node_node_storage
node_node_commands -->|"embeds search queries"| node_node_embedding
node_node_download_command -->|"invokes"| node_node_download_service
node_node_download_service -->|"provisions"| node_node_model
node_node_config_utils -->|"reads"| node_node_config
node_node_ingest -->|"uses settings"| node_node_config_utils
node_node_embedding -->|"uses settings"| node_node_config_utils
node_node_agentic_command -->|"invokes"| node_node_agentic_service
node_node_agentic_service -->|"uses"| node_node_agentic_config

click node_node_cli "https://github.com/kamalsoft/transformer-embedding/blob/main/src/index.ts"
click node_node_ingest "https://github.com/kamalsoft/transformer-embedding/blob/main/src/commands/ingest.ts"
click node_node_file_walker "https://github.com/kamalsoft/transformer-embedding/blob/main/src/utils/fileWalker.ts"
click node_node_parsers "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/parsers/csvParser.ts"
click node_node_embedding "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/embedding.ts"
click node_node_embedding_worker "https://github.com/kamalsoft/transformer-embedding/blob/main/src/commands/embedding.worker.ts"
click node_node_model_manager "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/modelManager.ts"
click node_node_model "https://github.com/kamalsoft/transformer-embedding/blob/main/model/embeddings/all-MiniLM-L6-v2/onnx/model.onnx"
click node_node_bm25 "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/bm25.ts"
click node_node_storage "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/storage.ts"
click node_node_lancedb "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/storage/lanceDbService.ts"
click node_node_config "https://github.com/kamalsoft/transformer-embedding/blob/main/config.json"
click node_node_config_utils "https://github.com/kamalsoft/transformer-embedding/blob/main/src/utils/config.ts"
click node_node_download_command "https://github.com/kamalsoft/transformer-embedding/blob/main/src/commands/downloadModels.ts"
click node_node_download_service "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/downloadModels.ts"
click node_node_agentic_command "https://github.com/kamalsoft/transformer-embedding/blob/main/src/commands/agenticExtract.ts"
click node_node_agentic_service "https://github.com/kamalsoft/transformer-embedding/blob/main/src/services/agenticExtractService.ts"
click node_node_agentic_config "https://github.com/kamalsoft/transformer-embedding/blob/main/src/utils/agenticExtractConfig.ts"

classDef toneNeutral fill:#f8fafc,stroke:#334155,stroke-width:1.5px,color:#0f172a
classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554
classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337
classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81
classDef toneTeal fill:#ccfbf1,stroke:#0f766e,stroke-width:1.5px,color:#134e4a
class node_node_cli,node_node_commands,node_node_download_command toneBlue
class node_node_ingest,node_node_file_walker,node_node_parsers,node_node_chunking toneAmber
class node_node_bm25,node_node_storage,node_node_lancedb toneMint
class node_node_embedding,node_node_embedding_worker,node_node_model_manager,node_node_model,node_node_download_service toneRose
class node_node_agentic_command,node_node_agentic_service,node_node_agentic_config toneIndigo
class node_node_config,node_node_config_utils toneNeutral
```

## 🛠️ Technology Stack

- **Runtime:** Node.js (ESM)
- **Language:** TypeScript
- **CLI Framework:** Commander.js
- **Machine Learning:** @huggingface/transformers
- **File System:** `fs-extra` for robust directory and file operations.
- **UI:** `ora` for terminal spinners and `chalk` for colorized output.

## 📁 Project Structure

```text
├── package.json
├── tsconfig.json
├── config.json         # Central configuration file
├── model/              # Local storage for ONNX models
├── vector-store/       # Local index storage
└── src/
    ├── index.ts        # Entry point and command registration
    ├── commands/       # Ingest and Config command implementations
    ├── services/       # Embedding, BM25, and Storage logic
    ├── scripts/        # Utility scripts (e.g., model download)
    └── utils/          # File system utilities
```

## ⚙️ Setup & Installation

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Link the CLI (Optional):**
   ```bash
   npm link
   ```


### How to Download the Models

1.  **Build the project:**
    ```bash
    npm run build
    ```
2.  **Run the download script:**
    ```bash
    npm run download-models
    ```

This command will download the `Xenova/all-MiniLM-L6-v2` model (as specified in your `config.json`) and place its files into the `./model/embeddings/all-MiniLM-L6-v2` directory, making it available for local use by the `ask-doc` CLI.


## ⌨️ Command Reference

### `ingest`
Scan a local directory, parse documents, and generate local embeddings and BM25 indices.

- **Ingest all files in a directory:**
  ```bash
  ask-doc ingest --path ./docs
  ```
- **Ingest specific file types:**
  ```bash
  ask-doc ingest --path ./docs --filetype .pdf
  ```

### `config get`
Retrieve settings from the central `config.json` file.

- **View model configuration:**
  ```bash
  ask-doc config get models
  ```

### `config set`
Update configuration values directly from the CLI.

- **Modify chunk size:**
  ```bash
  ask-doc config set ingestion --key chunk_size --value 800
  ```
- **Disable a model:**
  ```bash
  ask-doc config set models --key active --value false --id xenova-minilm
  ```

### `download-models` (Script)
Utility to fetch pre-trained models for local use.

```bash
npm run download-models
```

## 🗺️ Roadmap

### Phase 1: Search & Hybrid Retrieval (Short-term)
- [ ] **`ask-doc query` Command:** Implement hybrid search (BM25 + Vector) with reranking support.
- [ ] **Metadata Filtering:** Allow filtering search results by file path, creation date, or custom tags.
- [ ] **Index Integrity:** Enhance validation scripts to auto-repair corrupted or outdated indices.

### Phase 2: Local Intelligence (Mid-term)
- [ ] **Local LLM Integration:** Integrate with Ollama or local ONNX-based LLMs (e.g., Llama 3) to provide natural language answers.
- [ ] **Reranking:** Implement a local Cross-Encoder to significantly improve retrieval precision.
- [ ] **Semantic Chunking:** Move beyond fixed-size chunks to intelligent splitting based on document structure and context.

### Phase 3: Scaling & Ecosystem (Long-term)
- [ ] **Desktop GUI:** A cross-platform desktop interface for users who prefer a visual workspace.
- [ ] **API Mode:** Headless mode to serve the `ask-doc` engine as a local REST API.

## 🔍 How it Works

- **Walking:** The `fileWalker` utility recursively scans the provided path for the specified file extension.
- **Chunking:** Documents are split into overlapping segments based on `chunk_size` and `chunk_overlap` defined in `config.json`.
- **Embedding:** The `EmbeddingService` loads a local model from the `./model/` directory (using ONNX runtime) to transform text chunks into vectors.
- **Storage:** 
    - **Vectors:** Persisted in **LanceDB**, enabling sub-millisecond retrieval of context chunks.
    - **BM25:** A sparse index is built to support keyword-based retrieval alongside semantic search.

## 📝 License
MIT
