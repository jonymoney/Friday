import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface FeedItem {
  title: string;
  summary: string;
  source: string;
  priority: 'high' | 'medium' | 'low';
  time?: string;
  createdAt: Date;
}

export class FeedService {
  /**
   * Generate personalized feed for user
   */
  static async generateFeed(userId: string): Promise<FeedItem[]> {
    const now = new Date();

    // 1. Get recent calendar events (reduced from 10 to 5)
    const todayEvents = await prisma.userContext.findMany({
      where: {
        userId,
        source: 'google_calendar',
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    });

    // 2. Get recent context from other sources (reduced from 10 to 3)
    const recentContext = await prisma.userContext.findMany({
      where: {
        userId,
        source: {
          not: 'google_calendar',
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 3,
    });

    // 3. Combine all context
    const allContext = [...todayEvents, ...recentContext];

    if (allContext.length === 0) {
      return [];
    }

    // 4. Use GPT-4 to analyze, rank, and summarize (with truncated content)
    const contextText = allContext
      .map((ctx, idx) => {
        // Truncate content to 600 chars to prevent token overflow
        const truncatedContent = ctx.content.length > 600
          ? ctx.content.substring(0, 600) + '...[truncated]'
          : ctx.content;
        return `[${idx + 1}] ${truncatedContent}`;
      })
      .join('\n\n');

    const currentTime = now.toISOString();
    const prompt = `You are a personal assistant creating a prioritized daily feed.

Current time: ${currentTime}

User's calendar events and recent context:
${contextText}

Task: Create a feed of the 5-10 most important items for the user today. For each item:
1. Extract a clear, concise title (max 50 chars)
2. Write a brief summary highlighting key details (who, what, when, where)
3. Assign priority: "high" (urgent/important), "medium" (relevant), or "low" (nice to know)
4. Extract time if it's an event with a specific time

Focus on:
- Upcoming meetings/events (within next few hours are highest priority)
- Important recent items that need attention
- Time-sensitive information

Return ONLY valid JSON in this exact format:
{
  "items": [
    {
      "title": "Budget meeting",
      "summary": "Team budget review with Sarah at 2pm, bring Q1 reports",
      "priority": "high",
      "time": "14:00"
    }
  ]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0].message.content || '{"items":[]}';

    // 5. Parse and return feed items
    try {
      const parsed = JSON.parse(responseText);
      const items = parsed.items || [];

      // Add source and createdAt to each item
      return items.map((item: any) => ({
        title: item.title || 'Untitled',
        summary: item.summary || '',
        source: item.source || 'calendar',
        priority: item.priority || 'medium',
        time: item.time,
        createdAt: now,
      }));
    } catch (error) {
      console.error('Error parsing GPT-4 response:', error);
      return [];
    }
  }

  /**
   * Get feed with caching (optional future enhancement)
   */
  static async getFeed(userId: string): Promise<FeedItem[]> {
    // For now, just generate fresh feed
    // In production, add caching with 5-10 minute TTL
    return await this.generateFeed(userId);
  }

  /**
   * Get feed statistics
   */
  static async getFeedStats(userId: string): Promise<{
    totalItems: number;
    highPriority: number;
    upcomingEvents: number;
  }> {
    const feed = await this.getFeed(userId);

    return {
      totalItems: feed.length,
      highPriority: feed.filter((item) => item.priority === 'high').length,
      upcomingEvents: feed.filter((item) => item.time).length,
    };
  }
}
