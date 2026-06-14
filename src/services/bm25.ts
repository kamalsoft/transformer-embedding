export class BM25Service {
  // Simplified BM25 / Sparse Search logic
  private index: Map<string, string[]> = new Map();

  addDocument(text: string, source: string) {
    const tokens = text.toLowerCase().split(/\W+/);
    tokens.forEach(token => {
      if (!this.index.has(token)) this.index.set(token, []);
      this.index.get(token)?.push(source);
    });
  }
}