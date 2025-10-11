import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface SearchResult {
  id: string;
  userId: string;
  source: string;
  content: string;
  createdAt: Date;
  similarity?: number;
}

export class VectorStore {
  /**
   * Calculate cosine similarity between two embeddings
   */
  private static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

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

  /**
   * Search for similar content using semantic search
   */
  static async searchSimilar(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    // Generate embedding for the query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 1536,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Fetch all user contexts with embeddings
    const contexts = await prisma.userContext.findMany({
      where: {
        userId,
        embedding: {
          not: null,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate similarity scores
    const resultsWithSimilarity = contexts
      .map((context) => {
        const embedding = context.embedding as number[];
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);

        return {
          id: context.id,
          userId: context.userId,
          source: context.source,
          content: context.content,
          createdAt: context.createdAt,
          similarity,
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return resultsWithSimilarity;
  }

  /**
   * Get recent context (last 24 hours)
   */
  static async getRecentContext(
    userId: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const contexts = await prisma.userContext.findMany({
      where: {
        userId,
        createdAt: {
          gte: twentyFourHoursAgo,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      select: {
        id: true,
        userId: true,
        source: true,
        content: true,
        createdAt: true,
      },
    });

    return contexts;
  }

  /**
   * Combine semantic and temporal results for comprehensive context
   */
  static async getRelevantContext(
    userId: string,
    query: string,
    options: {
      semanticLimit?: number;
      recentLimit?: number;
      semanticWeight?: number;
    } = {}
  ): Promise<{
    semantic: SearchResult[];
    recent: SearchResult[];
    combined: SearchResult[];
  }> {
    const {
      semanticLimit = 10,
      recentLimit = 5,
      semanticWeight = 0.7,
    } = options;

    // Get both semantic and recent results
    const [semantic, recent] = await Promise.all([
      this.searchSimilar(userId, query, semanticLimit),
      this.getRecentContext(userId, recentLimit),
    ]);

    // Combine and deduplicate results
    const seenIds = new Set<string>();
    const combined: SearchResult[] = [];

    // Add semantic results with weighted scoring
    semantic.forEach((result) => {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        combined.push({
          ...result,
          similarity: result.similarity! * semanticWeight,
        });
      }
    });

    // Add recent results with temporal scoring
    recent.forEach((result, index) => {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        // Temporal score: more recent = higher score
        const temporalScore = (1 - index / recentLimit) * (1 - semanticWeight);
        combined.push({
          ...result,
          similarity: temporalScore,
        });
      }
    });

    // Sort combined results by final score
    combined.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

    return {
      semantic,
      recent,
      combined,
    };
  }

  /**
   * Search with filters (by source, date range, etc.)
   */
  static async advancedSearch(
    userId: string,
    query: string,
    filters: {
      source?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    } = {}
  ): Promise<SearchResult[]> {
    const { source, startDate, endDate, limit = 10 } = filters;

    // Build where clause
    const where: any = {
      userId,
      embedding: {
        not: null,
      },
    };

    if (source) {
      where.source = source;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    // Generate query embedding
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 1536,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Fetch filtered contexts
    const contexts = await prisma.userContext.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate similarity and sort
    const resultsWithSimilarity = contexts
      .map((context) => {
        const embedding = context.embedding as number[];
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);

        return {
          id: context.id,
          userId: context.userId,
          source: context.source,
          content: context.content,
          createdAt: context.createdAt,
          similarity,
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return resultsWithSimilarity;
  }

  /**
   * Get statistics about user's context
   */
  static async getStats(userId: string): Promise<{
    totalContexts: number;
    bySource: Record<string, number>;
    oldestContext: Date | null;
    newestContext: Date | null;
  }> {
    const contexts = await prisma.userContext.findMany({
      where: { userId },
      select: {
        source: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const bySource: Record<string, number> = {};
    contexts.forEach((ctx) => {
      bySource[ctx.source] = (bySource[ctx.source] || 0) + 1;
    });

    return {
      totalContexts: contexts.length,
      bySource,
      oldestContext: contexts[0]?.createdAt || null,
      newestContext: contexts[contexts.length - 1]?.createdAt || null,
    };
  }
}
