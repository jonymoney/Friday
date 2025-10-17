import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { AuthService } from './services/auth';
import { IngestionService } from './services/ingestion';
import { VectorStore } from './services/vectorStore';
import { AgentService } from './services/agent';
import { FeedService } from './services/feed';
import { ProfileService } from './services/profile';
import { requireAuth } from './middleware/auth';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Middleware
app.use(express.json());

// Create API router
const apiRouter = express.Router();

// Health check endpoint
apiRouter.get('/health', async (req: Request, res: Response) => {
  try {
    // Test database connection using Prisma
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// Auth endpoints
apiRouter.get('/auth/google', (req: Request, res: Response) => {
  try {
    const authUrl = AuthService.getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    console.error('Auth URL generation error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

apiRouter.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code missing' });
    }

    const { token, user } = await AuthService.handleCallback(code);

    // Redirect to frontend with token and user data
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Auth callback error:', error);

    // Redirect to frontend with error
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
    const redirectUrl = `${frontendUrl}/auth/callback?error=${encodeURIComponent(errorMessage)}`;

    res.redirect(redirectUrl);
  }
});

apiRouter.get('/auth/status', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const hasTokens = await AuthService.hasValidTokens(req.user.userId);
    res.json({
      authenticated: true,
      user: req.user,
      hasGoogleTokens: hasTokens,
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Failed to check auth status' });
  }
});

// Protected sync endpoints
apiRouter.post('/sync/calendar', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await IngestionService.syncCalendar(req.user.userId);
    res.json({
      message: 'Calendar sync completed',
      ...result,
    });
  } catch (error) {
    console.error('Calendar sync error:', error);
    res.status(500).json({ error: 'Failed to sync calendar' });
  }
});

apiRouter.post('/sync/emails', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await IngestionService.syncEmails(req.user.userId);
    res.json({
      message: 'Gmail sync completed',
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    console.error('Gmail sync error:', error);
    res.status(500).json({ error: 'Failed to sync Gmail' });
  }
});

// Get user context (for testing)
apiRouter.get('/context', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const contexts = await IngestionService.getUserContext(req.user.userId);
    res.json({ contexts });
  } catch (error) {
    console.error('Get context error:', error);
    res.status(500).json({ error: 'Failed to get context' });
  }
});

// Search endpoints
apiRouter.post('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { query, limit = 10 } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required and must be a string' });
    }

    const results = await VectorStore.searchSimilar(
      req.user.userId,
      query,
      limit
    );

    res.json({ query, results, count: results.length });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

apiRouter.get('/search/recent', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const results = await VectorStore.getRecentContext(req.user.userId, limit);

    res.json({ results, count: results.length });
  } catch (error) {
    console.error('Recent context error:', error);
    res.status(500).json({ error: 'Failed to get recent context' });
  }
});

// AI query endpoint
apiRouter.post('/query', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required and must be a string' });
    }

    const result = await AgentService.answerQuestion(req.user.userId, question);

    res.json({
      question,
      answer: result.answer,
      sources: result.sources,
      toolsUsed: result.toolsUsed,
    });
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ error: 'Failed to answer question' });
  }
});

// Feed endpoints

// Generate new feed items (SLOW - processes unprocessed context)
apiRouter.post('/feed/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await FeedService.generateNewFeedItems(req.user.userId);

    res.json({
      message: 'Feed generation completed',
      generated: result.generated,
      skipped: result.skipped,
      errors: result.errors,
      total: result.generated + result.skipped,
    });
  } catch (error) {
    console.error('Feed generation error:', error);
    res.status(500).json({ error: 'Failed to generate feed items' });
  }
});

// Get feed items (FAST - returns stored items)
apiRouter.get('/feed', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const includeExpired = req.query.includeExpired === 'true';

    const feedItems = await FeedService.getFeedItems(req.user.userId, {
      limit,
      offset,
      includeExpired,
    });

    res.json({
      items: feedItems,
      count: feedItems.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Feed retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve feed items' });
  }
});

// Update feed item status
apiRouter.patch('/feed/:feedItemId/status', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { feedItemId } = req.params;
    const { status, snoozeUntil } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const updatedItem = await FeedService.updateFeedItemStatus(
      feedItemId,
      status,
      snoozeUntil ? new Date(snoozeUntil) : undefined
    );

    res.json({
      message: 'Feed item status updated',
      item: updatedItem,
    });
  } catch (error) {
    console.error('Feed item update error:', error);
    res.status(500).json({ error: 'Failed to update feed item status' });
  }
});

// Record interaction with feed item
apiRouter.post('/feed/:feedItemId/interaction', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { feedItemId } = req.params;
    const { actionId, actionType, result, durationMs, errorMessage } = req.body;

    if (!actionId || !actionType) {
      return res.status(400).json({ error: 'actionId and actionType are required' });
    }

    const interaction = await FeedService.recordInteraction(
      feedItemId,
      actionId,
      actionType,
      result,
      durationMs,
      errorMessage
    );

    res.json({
      message: 'Interaction recorded',
      interaction,
    });
  } catch (error) {
    console.error('Interaction recording error:', error);
    res.status(500).json({ error: 'Failed to record interaction' });
  }
});

// Profile endpoints
apiRouter.put('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const profileData = req.body;

    if (!profileData || typeof profileData !== 'object') {
      return res.status(400).json({ error: 'Profile data is required' });
    }

    await ProfileService.updateProfile(req.user.userId, profileData);

    res.json({
      message: 'Profile updated successfully',
      profile: profileData,
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

apiRouter.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const profile = await ProfileService.getProfile(req.user.userId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ data: profile });
  } catch (error) {
    console.error('Profile get error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

apiRouter.delete('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    await ProfileService.deleteProfile(req.user.userId);

    res.json({ message: 'Profile deleted successfully' });
  } catch (error) {
    console.error('Profile delete error:', error);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// Mount API router under /api prefix
app.use('/api', apiRouter);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
