import { google, calendar_v3, gmail_v1 } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { AuthService } from './auth';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class IngestionService {
  /**
   * Sync calendar events for a user and generate embeddings
   */
  static async syncCalendar(userId: string): Promise<{ processed: number; errors: number }> {
    try {
      // Get authenticated Google client for user
      const authClient = await AuthService.getAuthClientForUser(userId);
      const calendar = google.calendar({ version: 'v3', auth: authClient });

      // Calculate time range (next 7 days)
      const now = new Date();
      const weekFromNow = new Date();
      weekFromNow.setDate(weekFromNow.getDate() + 7);

      // Fetch calendar events
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: weekFromNow.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      let processed = 0;
      let errors = 0;

      // Process each event
      for (const event of events) {
        try {
          await this.processCalendarEvent(userId, event);
          processed++;
        } catch (error) {
          console.error(`Error processing event ${event.id}:`, error);
          errors++;
        }
      }

      return { processed, errors };
    } catch (error) {
      console.error('Calendar sync error:', error);
      throw error;
    }
  }

  /**
   * Process a single calendar event: format content and generate embedding
   */
  private static async processCalendarEvent(
    userId: string,
    event: calendar_v3.Schema$Event
  ): Promise<void> {
    // Skip events without IDs (shouldn't happen but be safe)
    if (!event.id) {
      console.warn('Skipping event without ID');
      return;
    }

    // Format event into text content
    const content = this.formatEventContent(event);

    // Generate embedding using OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content,
      dimensions: 1536,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Upsert: Update if exists (by userId + source + sourceId), create if not
    // This prevents duplicate calendar events from being stored
    await prisma.userContext.upsert({
      where: {
        unique_source_item: {
          userId,
          source: 'google_calendar',
          sourceId: event.id,
        },
      },
      update: {
        content,
        embedding: embedding,
        updatedAt: new Date(),
      },
      create: {
        userId,
        source: 'google_calendar',
        sourceId: event.id,
        content,
        embedding: embedding,
      },
    });
  }

  /**
   * Format calendar event into readable text for embedding
   */
  private static formatEventContent(event: calendar_v3.Schema$Event): string {
    const parts: string[] = [];

    // Title
    if (event.summary) {
      parts.push(`Event: ${event.summary}`);
    }

    // Time
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    if (start) {
      parts.push(`Start: ${new Date(start).toLocaleString()}`);
    }
    if (end) {
      parts.push(`End: ${new Date(end).toLocaleString()}`);
    }

    // Description
    if (event.description) {
      parts.push(`Description: ${event.description}`);
    }

    // Location
    if (event.location) {
      parts.push(`Location: ${event.location}`);
    }

    // Attendees
    if (event.attendees && event.attendees.length > 0) {
      const attendeeNames = event.attendees
        .map((a) => a.email || 'Unknown')
        .join(', ');
      parts.push(`Attendees: ${attendeeNames}`);
    }

    return parts.join('\n');
  }

  /**
   * Get user context with optional semantic search (for future use)
   */
  static async getUserContext(userId: string, limit: number = 10) {
    return await prisma.userContext.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Sync Gmail emails for a user and generate embeddings
   */
  static async syncEmails(userId: string): Promise<{ processed: number; errors: number }> {
    try {
      // Get authenticated Google client for user
      const authClient = await AuthService.getAuthClientForUser(userId);
      const gmail = google.gmail({ version: 'v1', auth: authClient });

      // Calculate date for 7 days ago
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateString = sevenDaysAgo.toISOString().split('T')[0].replace(/-/g, '/');

      // Build query: last 7 days, not spam/trash
      const query = `after:${dateString} -in:spam -in:trash`;

      // Fetch message list
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100, // Limit to 100 most recent emails
      });

      const messages = response.data.messages || [];
      let processed = 0;
      let errors = 0;

      // Process each message
      for (const message of messages) {
        if (!message.id) continue;

        try {
          await this.processEmailMessage(userId, gmail, message.id);
          processed++;
        } catch (error) {
          console.error(`Error processing email ${message.id}:`, error);
          errors++;
        }
      }

      return { processed, errors };
    } catch (error) {
      console.error('Gmail sync error:', error);
      throw error;
    }
  }

  /**
   * Process a single email message: fetch full content, format, and generate embedding
   */
  private static async processEmailMessage(
    userId: string,
    gmail: gmail_v1.Gmail,
    messageId: string
  ): Promise<void> {
    // Fetch full message
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    if (!message.data) {
      console.warn(`No data for message ${messageId}`);
      return;
    }

    // Extract email metadata and content
    const emailData = this.extractEmailData(message.data);
    const content = this.formatEmailContent(emailData);

    // Generate embedding using OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content,
      dimensions: 1536,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Upsert: Update if exists (by messageId), create if not
    // This prevents duplicate emails from being stored
    await prisma.userContext.upsert({
      where: {
        unique_source_item: {
          userId,
          source: 'gmail',
          sourceId: messageId,
        },
      },
      update: {
        content,
        embedding: embedding,
        updatedAt: new Date(),
      },
      create: {
        userId,
        source: 'gmail',
        sourceId: messageId,
        content,
        embedding: embedding,
      },
    });
  }

  /**
   * Extract email data from Gmail API message
   */
  private static extractEmailData(message: gmail_v1.Schema$Message): {
    from: string;
    to: string;
    subject: string;
    date: string;
    body: string;
    threadId?: string;
  } {
    const headers = message.payload?.headers || [];

    const getHeader = (name: string): string => {
      const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
      return header?.value || '';
    };

    const from = getHeader('From');
    const to = getHeader('To');
    const subject = getHeader('Subject');
    const date = getHeader('Date');
    const threadId = message.threadId || undefined;

    // Extract body text
    let body = '';
    if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    } else if (message.payload?.parts) {
      // Multi-part message, try to find text/plain or text/html
      for (const part of message.payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          break;
        }
      }
      // If no text/plain found, try text/html
      if (!body) {
        for (const part of message.payload.parts) {
          if (part.mimeType === 'text/html' && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            // Strip HTML tags for embedding (basic cleanup)
            body = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            break;
          }
        }
      }
    }

    // Truncate very long emails (keep first 5000 chars for embedding)
    if (body.length > 5000) {
      body = body.substring(0, 5000) + '...';
    }

    return { from, to, subject, date, body, threadId };
  }

  /**
   * Format email data into readable text for embedding
   */
  private static formatEmailContent(emailData: {
    from: string;
    to: string;
    subject: string;
    date: string;
    body: string;
  }): string {
    const parts: string[] = [];

    parts.push('Email:');

    if (emailData.from) {
      parts.push(`From: ${emailData.from}`);
    }

    if (emailData.to) {
      parts.push(`To: ${emailData.to}`);
    }

    if (emailData.subject) {
      parts.push(`Subject: ${emailData.subject}`);
    }

    if (emailData.date) {
      parts.push(`Date: ${emailData.date}`);
    }

    if (emailData.body) {
      parts.push(`\nBody:\n${emailData.body}`);
    }

    return parts.join('\n');
  }
}
