import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface FeedAction {
  id: string;
  type: 'directions' | 'restaurant_search' | 'reminder' | 'prep' | 'weather_check';
  label: string;
  description: string;
  params: Record<string, any>;
}

interface FeedItem {
  title: string;
  summary: string;
  source: string;
  priority: 'high' | 'medium' | 'low';
  time?: string;
  createdAt: Date;
  actions?: FeedAction[]; // Optional array of actionable items
}

export class FeedService {
  /**
   * Generate personalized feed for user
   */
  static async generateFeed(userId: string): Promise<FeedItem[]> {
    const now = new Date();

    // 1. Get recent calendar events (increased to 10 with GPT-5's 400K context)
    const todayEvents = await prisma.userContext.findMany({
      where: {
        userId,
        source: 'google_calendar',
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });

    // 2. Get recent context from other sources (increased to 5 with GPT-5's 400K context)
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
      take: 5,
    });

    // 3. Combine all context
    const allContext = [...todayEvents, ...recentContext];

    if (allContext.length === 0) {
      return [];
    }

    // 4. Format context with more detail (GPT-5 has 400K context window)
    const contextText = allContext
      .map((ctx, idx) => {
        // Moderate truncation at 800 chars for balance of detail and efficiency
        const truncatedContent = ctx.content.length > 800
          ? ctx.content.substring(0, 800) + '...'
          : ctx.content;
        return `[${idx + 1}] Source: ${ctx.source}\n${truncatedContent}`;
      })
      .join('\n\n');

    const currentTime = now.toISOString();

    // Use proper system/user message structure for better results
    const systemMessage = `You are a personal assistant that creates prioritized daily feeds from user's calendar and context data. Current time: ${currentTime}

Your task: Analyze the user's context and create up to 10 actionable feed items. For high and medium priority items, suggest relevant actions the user can take.

For each item, provide:
- title: Clear, concise (max 50 chars)
- summary: Brief details (who, what, when, where)
- priority: "high" (urgent/important), "medium" (relevant), or "low" (nice to know)
- time: Specific time if applicable (ISO 8601 format with timezone)
- actions: Array of actionable suggestions (ONLY for high/medium priority items)

Action Types:
1. "directions": Get route with traffic (params: from, to, departureTime)
2. "restaurant_search": Find nearby restaurants (params: location, cuisine, dietary)
3. "weather_check": Check weather for event (params: location, datetime)
4. "prep": Meeting preparation brief (params: eventTitle, attendees)
5. "reminder": Set reminder (params: time, message)

Return ONLY valid JSON in this format:
{
  "items": [
    {
      "title": "Meeting title",
      "summary": "Brief summary with key details",
      "priority": "high",
      "time": "2025-10-11T14:00:00-07:00",
      "actions": [
        {
          "id": "unique-id",
          "type": "directions",
          "label": "Get directions",
          "description": "Calculate route with current traffic",
          "params": {
            "from": "current_location",
            "to": "Meeting location address",
            "departureTime": "2025-10-11T13:30:00-07:00"
          }
        }
      ]
    }
  ]
}

IMPORTANT: Generate unique IDs for actions (e.g., "action-1", "action-2"), include relevant context in params, and only add actions that would genuinely help the user.`;

    const userMessage = `Here is the user's context:\n\n${contextText}\n\nGenerate the feed items now.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5-chat-latest',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      max_completion_tokens: 1000, // Increased from 500 since we have 400K context
    });

    let responseText = completion.choices[0].message.content || '{"items":[]}';

    // Strip markdown code fences if present (GPT-5 sometimes adds them)
    responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();

    // 5. Parse and return feed items
    try {
      const parsed = JSON.parse(responseText);
      const items = parsed.items || [];

      // Add source and createdAt to each item, preserve actions if present
      return items.map((item: any) => ({
        title: item.title || 'Untitled',
        summary: item.summary || '',
        source: item.source || 'calendar',
        priority: item.priority || 'medium',
        time: item.time,
        createdAt: now,
        ...(item.actions && item.actions.length > 0 && { actions: item.actions }),
      }));
    } catch (error) {
      console.error('Error parsing GPT-5 response:', error);
      console.error('Raw response:', responseText);
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
