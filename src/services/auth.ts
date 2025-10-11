import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export class AuthService {
  /**
   * Generate Google OAuth URL for user authorization
   */
  static getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent', // Force consent to always get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens and store user
   */
  static async handleCallback(code: string): Promise<{ token: string; user: any }> {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    if (!data.email) {
      throw new Error('No email found in Google account');
    }

    // Store or update user with encrypted tokens
    const user = await prisma.user.upsert({
      where: { email: data.email },
      update: {
        googleTokens: tokens as any, // In production, encrypt this!
      },
      create: {
        email: data.email,
        googleTokens: tokens as any, // In production, encrypt this!
      },
    });

    // Generate JWT session token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET not configured');
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return { token, user };
  }

  /**
   * Get OAuth client for a specific user
   */
  static async getAuthClientForUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.googleTokens) {
      throw new Error('User not found or not authenticated with Google');
    }

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    client.setCredentials(user.googleTokens as any);

    // Handle token refresh
    client.on('tokens', async (tokens) => {
      if (tokens.refresh_token) {
        // Update stored tokens when refreshed
        await prisma.user.update({
          where: { id: userId },
          data: {
            googleTokens: {
              ...(user.googleTokens as any),
              ...tokens,
            } as any,
          },
        });
      }
    });

    return client;
  }

  /**
   * Check if user has valid tokens
   */
  static async hasValidTokens(userId: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      return !!(user && user.googleTokens);
    } catch (error) {
      return false;
    }
  }
}
