import lancedb
import pandas as pd

# Connect to the directory defined in your config.json
db = lancedb.connect("./vector-store")

# Open the table defined in your LanceDbService
table = db.open_table("document_chunks")

# 1. Check total record count
print(f"Total Chunks: {table.count_rows()}")

# 2. Inspect the schema and first 5 rows
# This will show the text, file_path, and metadata
df = table.head(5).to_pandas()
print("\n--- Data Sample ---")
print(df[['file_path', 'chunk_index', 'text']])

# 3. Verify vector integrity
print("\n--- Vector Dimensions ---")
sample_vector = df['vector'].iloc[0]
print(f"Vector size: {len(sample_vector)}")
