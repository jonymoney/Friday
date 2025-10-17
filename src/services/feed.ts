import { PrismaClient, FeedItemType, FeedItemPriority, FeedItemStatus, ActionType, ActionStyle, Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { DataSource, ActionConfig, ContextInfo, CreateFeedItemInput } from '../types/feed';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// GPT response interface
interface GPTFeedItem {
  title: string;
  summary: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  time?: string;
  source?: string;
  actions?: GPTAction[];
}

interface GPTAction {
  id: string;
  type: string;
  label: string;
  description: string;
  params: Record<string, any>;
}

export class FeedService {
  /**
   * Generate new feed items from user context that hasn't been processed yet
   * This is the SLOW endpoint - typically called by cron or manual trigger
   */
  static async generateNewFeedItems(userId: string): Promise<{
    generated: number;
    skipped: number;
    errors: number;
  }> {
    const now = new Date();

    // 1. Get all user context items
    const allContext = await prisma.userContext.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20, // Process up to 20 context items
    });

    if (allContext.length === 0) {
      return { generated: 0, skipped: 0, errors: 0 };
    }

    // 2. Get existing feed items to check which sourceIds we've already processed
    const existingSourceIds = await prisma.feedItem.findMany({
      where: { userId },
      select: { sourceId: true },
    });

    const processedSourceIds = new Set(existingSourceIds.map((item) => item.sourceId));

    // 3. Filter to only NEW context items that haven't been converted to feed items
    const newContext = allContext.filter((ctx) => {
      const sourceId = `${ctx.source}-${ctx.id}`;
      return !processedSourceIds.has(sourceId);
    });

    if (newContext.length === 0) {
      console.log('No new context to process - all items already have feed entries');
      return { generated: 0, skipped: allContext.length, errors: 0 };
    }

    console.log(`Processing ${newContext.length} new context items (${allContext.length - newContext.length} already processed)`);

    // 4. Format context for GPT
    const contextText = newContext
      .map((ctx, idx) => {
        const truncatedContent = ctx.content.length > 800
          ? ctx.content.substring(0, 800) + '...'
          : ctx.content;
        return `[${idx + 1}] Source: ${ctx.source} | SourceID: ${ctx.id}\n${truncatedContent}`;
      })
      .join('\n\n');

    const currentTime = now.toISOString();

    // 5. Generate feed items via GPT
    const systemMessage = `You are a personal assistant that creates prioritized feed items from user's context data. Current time: ${currentTime}

Your task: Analyze the user's context and create actionable feed items. For each context item, determine the appropriate type and create relevant actions.

Feed Item Types:
- CALENDAR_EVENT: Calendar meetings/events
- EMAIL: Important emails
- ARTICLE: Newsletter articles, blog posts
- TASK: To-do items
- REMINDER: Time-based reminders
- NOTIFICATION: General notifications
- SUGGESTION: Proactive suggestions
- ALERT: Urgent alerts

For each item, provide:
- title: Clear, concise (max 50 chars)
- summary: Brief details (who, what, when, where)
- priority: "urgent", "high", "medium", or "low"
- type: One of the types above
- time: Specific time if applicable (ISO 8601 format with timezone)
- sourceIndex: The index number from the context (e.g., 1, 2, 3)
- actions: Array of actionable suggestions (ONLY for high/urgent priority items)

Action Types (use these exact strings):
- "NAVIGATE": Open URL or deep link
- "API_CALL": Make API request
- "INLINE": Execute inline action
- "DISMISS": Dismiss item
- "SNOOZE": Snooze until later
- "COMPLETE": Mark as complete
- "CUSTOM": Custom action

Return ONLY valid JSON in this format:
{
  "items": [
    {
      "title": "Meeting title",
      "summary": "Brief summary with key details",
      "type": "CALENDAR_EVENT",
      "priority": "high",
      "time": "2025-10-11T14:00:00-07:00",
      "sourceIndex": 1,
      "actions": [
        {
          "id": "action-1",
          "type": "NAVIGATE",
          "label": "Get directions",
          "description": "Calculate route with current traffic",
          "params": {
            "url": "https://maps.google.com/?q=location",
            "openInNewTab": true
          }
        }
      ]
    }
  ]
}

IMPORTANT:
- Use sourceIndex to reference which context item this feed item is from
- Generate unique IDs for actions (e.g., "action-1", "action-2")
- Only add actions that would genuinely help the user
- For newsletter emails with multiple articles, create separate items for each article with type "ARTICLE"`;

    const userMessage = `Here is the user's NEW context that needs to be processed:\n\n${contextText}\n\nGenerate the feed items now.`;

    let gptItems: GPTFeedItem[] = [];
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-5-chat-latest',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ],
        max_completion_tokens: 3000,
      });

      let responseText = completion.choices[0].message.content || '{"items":[]}';
      responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();

      const parsed = JSON.parse(responseText);
      gptItems = parsed.items || [];
    } catch (error) {
      console.error('Error generating feed items with GPT:', error);
      return { generated: 0, skipped: newContext.length, errors: 1 };
    }

    // 6. Store feed items in database
    let generated = 0;
    let errors = 0;

    for (const gptItem of gptItems) {
      try {
        // Map sourceIndex back to the actual context item
        const sourceIndex = (gptItem as any).sourceIndex || 1;
        const contextItem = newContext[sourceIndex - 1];

        if (!contextItem) {
          console.warn(`Invalid sourceIndex ${sourceIndex}, skipping item`);
          errors++;
          continue;
        }

        const sourceId = `${contextItem.source}-${contextItem.id}`;

        // Map priority
        const priority = this.mapPriority(gptItem.priority);

        // Map type (default to appropriate type based on source)
        const type = this.mapType((gptItem as any).type, contextItem.source);

        // Create source object
        const source: DataSource = {
          type: this.mapSourceType(contextItem.source),
          accountId: userId,
          integrationName: contextItem.source,
          sourceUrl: undefined, // Can be enhanced later
        };

        // Parse time
        const timestamp = gptItem.time ? new Date(gptItem.time) : now;

        // Set expiration (24 hours for most items, event end time for calendar)
        const expiresAt = type === 'CALENDAR_EVENT' && gptItem.time
          ? new Date(new Date(gptItem.time).getTime() + 3 * 60 * 60 * 1000) // 3 hours after event
          : new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

        // Create feed item with actions
        const feedItem = await prisma.feedItem.create({
          data: {
            userId,
            type,
            priority,
            timestamp,
            expiresAt,
            title: gptItem.title,
            subtitle: undefined,
            description: gptItem.summary,
            source: source as any,
            sourceId,
            metadata: {},
            tags: [contextItem.source],
            relatedItems: [],
            status: FeedItemStatus.NEW,
            actions: {
              create: (gptItem.actions || []).map((action, idx) => ({
                label: action.label,
                type: this.mapActionType(action.type),
                style: idx === 0 ? ActionStyle.PRIMARY : ActionStyle.SECONDARY,
                config: (action.params || {}) as any,
                enabled: true,
                requiresConfirmation: false,
                isAsync: false,
              })),
            },
          },
        });

        generated++;
        console.log(`Created feed item: ${feedItem.title} (${feedItem.id})`);
      } catch (error) {
        console.error('Error storing feed item:', error);
        errors++;
      }
    }

    return {
      generated,
      skipped: allContext.length - newContext.length,
      errors,
    };
  }

  /**
   * Get feed items for user - FAST endpoint for clients
   * Returns stored feed items from database
   */
  static async getFeedItems(userId: string, options?: {
    status?: FeedItemStatus[];
    priority?: FeedItemPriority[];
    limit?: number;
    offset?: number;
    includeExpired?: boolean;
  }) {
    const now = new Date();

    const where: Prisma.FeedItemWhereInput = {
      userId,
      // Default: show NEW and SNOOZED items
      status: options?.status || {
        in: [FeedItemStatus.NEW, FeedItemStatus.SNOOZED],
      },
      // Default: exclude expired items
      ...(!options?.includeExpired && {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      }),
      // Filter by snoozed items whose snooze time has passed
      OR: [
        { status: { not: FeedItemStatus.SNOOZED } },
        {
          AND: [
            { status: FeedItemStatus.SNOOZED },
            { snoozeUntil: { lte: now } },
          ],
        },
      ],
    };

    if (options?.priority) {
      where.priority = { in: options.priority };
    }

    const feedItems = await prisma.feedItem.findMany({
      where,
      include: {
        actions: true,
        interactionHistory: {
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
      },
      orderBy: [
        { priority: 'asc' }, // URGENT first, then HIGH, MEDIUM, LOW
        { timestamp: 'asc' },
      ],
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });

    return feedItems;
  }

  /**
   * Update feed item status
   */
  static async updateFeedItemStatus(
    feedItemId: string,
    status: FeedItemStatus,
    snoozeUntil?: Date
  ) {
    return await prisma.feedItem.update({
      where: { id: feedItemId },
      data: {
        status,
        ...(snoozeUntil && { snoozeUntil }),
      },
    });
  }

  /**
   * Record interaction with feed item
   */
  static async recordInteraction(
    feedItemId: string,
    actionId: string,
    actionType: string,
    result?: 'success' | 'failure' | 'cancelled',
    durationMs?: number,
    errorMessage?: string
  ) {
    return await prisma.interaction.create({
      data: {
        feedItemId,
        actionId,
        actionType,
        result,
        durationMs,
        errorMessage,
        metadata: {},
      },
    });
  }

  /**
   * Cleanup expired feed items
   */
  static async cleanupExpiredItems(userId: string) {
    const now = new Date();

    const result = await prisma.feedItem.updateMany({
      where: {
        userId,
        expiresAt: { lt: now },
        status: { not: FeedItemStatus.EXPIRED },
      },
      data: {
        status: FeedItemStatus.EXPIRED,
      },
    });

    return result.count;
  }

  // Helper methods
  private static mapPriority(priority: string): FeedItemPriority {
    switch (priority.toLowerCase()) {
      case 'urgent': return FeedItemPriority.URGENT;
      case 'high': return FeedItemPriority.HIGH;
      case 'medium': return FeedItemPriority.MEDIUM;
      case 'low': return FeedItemPriority.LOW;
      default: return FeedItemPriority.MEDIUM;
    }
  }

  private static mapType(type: string | undefined, source: string): FeedItemType {
    if (type) {
      const typeUpper = type.toUpperCase();
      if (typeUpper in FeedItemType) {
        return FeedItemType[typeUpper as keyof typeof FeedItemType];
      }
    }

    // Fallback based on source
    if (source.includes('calendar')) return FeedItemType.CALENDAR_EVENT;
    if (source.includes('gmail') || source.includes('email')) return FeedItemType.EMAIL;
    return FeedItemType.NOTIFICATION;
  }

  private static mapSourceType(source: string): DataSource['type'] {
    if (source.includes('gmail') || source.includes('email')) return 'gmail';
    if (source.includes('calendar')) return 'calendar';
    if (source.includes('notion')) return 'notion';
    if (source.includes('drive')) return 'drive';
    return 'custom';
  }

  private static mapActionType(type: string): ActionType {
    const typeUpper = type.toUpperCase();
    if (typeUpper in ActionType) {
      return ActionType[typeUpper as keyof typeof ActionType];
    }
    return ActionType.CUSTOM;
  }
}
