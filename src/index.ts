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

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
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
app.get('/auth/google', (req: Request, res: Response) => {
  try {
    const authUrl = AuthService.getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    console.error('Auth URL generation error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

app.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code missing' });
    }

    const { token, user } = await AuthService.handleCallback(code);

    // In production, you might want to set this as an httpOnly cookie
    // or redirect to frontend with token
    res.json({
      message: 'Authentication successful',
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

app.get('/auth/status', requireAuth, async (req: Request, res: Response) => {
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
app.post('/sync/calendar', requireAuth, async (req: Request, res: Response) => {
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

app.post('/sync/emails', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await IngestionService.syncEmails(req.user.userId);
    res.json({
      message: 'Gmail sync completed',
      ...result,
    });
  } catch (error) {
    console.error('Gmail sync error:', error);
    res.status(500).json({ error: 'Failed to sync Gmail' });
  }
});

// Get user context (for testing)
app.get('/context', requireAuth, async (req: Request, res: Response) => {
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
app.post('/search', requireAuth, async (req: Request, res: Response) => {
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

app.get('/search/recent', requireAuth, async (req: Request, res: Response) => {
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
app.post('/query', requireAuth, async (req: Request, res: Response) => {
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

// Personalized feed endpoint
app.get('/feed', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const feed = await FeedService.getFeed(req.user.userId);

    res.json({
      items: feed,
      count: feed.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Feed error:', error);
    res.status(500).json({ error: 'Failed to generate feed' });
  }
});

// Profile endpoints
app.put('/profile', requireAuth, async (req: Request, res: Response) => {
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

app.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const profile = await ProfileService.getProfile(req.user.userId);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile });
  } catch (error) {
    console.error('Profile get error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

app.delete('/profile', requireAuth, async (req: Request, res: Response) => {
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
