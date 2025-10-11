import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class ProfileService {
  /**
   * Update user profile and create searchable context
   */
  static async updateProfile(userId: string, profileData: any): Promise<any> {
    // 1. Store in UserProfile table
    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        data: profileData,
      },
      create: {
        userId,
        data: profileData,
      },
    });

    // 2. Format profile data for context
    const contextString = this.formatProfileForContext(profileData);

    // 3. Generate embedding
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: contextString,
      dimensions: 1536,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // 4. Upsert searchable context entry (update if exists, create if not)
    // Use a fixed sourceId for profile since there's only one profile per user
    await prisma.userContext.upsert({
      where: {
        unique_source_item: {
          userId,
          source: 'profile',
          sourceId: 'user_profile', // Fixed ID since each user has only one profile
        },
      },
      update: {
        content: contextString,
        embedding: embedding,
        updatedAt: new Date(),
      },
      create: {
        userId,
        source: 'profile',
        sourceId: 'user_profile',
        content: contextString,
        embedding: embedding,
      },
    });

    return profile;
  }

  /**
   * Get user profile
   */
  static async getProfile(userId: string): Promise<any | null> {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
    });

    return profile?.data || null;
  }

  /**
   * Format profile data into human-readable context string
   */
  private static formatProfileForContext(profileData: any): string {
    const parts: string[] = ['User Profile Information:'];

    if (profileData.name) {
      parts.push(`Name: ${profileData.name}`);
    }

    if (profileData.birthday) {
      parts.push(`Birthday: ${profileData.birthday}`);
    }

    if (profileData.homeAddress) {
      parts.push(`Home Address: ${profileData.homeAddress}`);
    }

    if (profileData.workAddress) {
      parts.push(`Work Address: ${profileData.workAddress}`);
    }

    if (profileData.phone) {
      parts.push(`Phone: ${profileData.phone}`);
    }

    if (profileData.preferences) {
      parts.push('Preferences:');

      if (profileData.preferences.dietaryRestrictions) {
        parts.push(
          `  - Dietary restrictions: ${profileData.preferences.dietaryRestrictions.join(', ')}`
        );
      }

      if (profileData.preferences.commuteMethod) {
        parts.push(`  - Commute method: ${profileData.preferences.commuteMethod}`);
      }

      if (profileData.preferences.timezone) {
        parts.push(`  - Timezone: ${profileData.preferences.timezone}`);
      }

      // Add any other custom preferences
      Object.keys(profileData.preferences).forEach((key) => {
        if (
          !['dietaryRestrictions', 'commuteMethod', 'timezone'].includes(key)
        ) {
          const value = profileData.preferences[key];
          parts.push(
            `  - ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`
          );
        }
      });
    }

    // Add any other custom fields
    Object.keys(profileData).forEach((key) => {
      if (
        ![
          'name',
          'birthday',
          'homeAddress',
          'workAddress',
          'phone',
          'preferences',
        ].includes(key)
      ) {
        const value = profileData[key];
        parts.push(
          `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`
        );
      }
    });

    return parts.join('\n');
  }

  /**
   * Delete user profile
   */
  static async deleteProfile(userId: string): Promise<void> {
    // Delete profile
    await prisma.userProfile.deleteMany({
      where: { userId },
    });

    // Delete profile context (using sourceId for precise deletion)
    await prisma.userContext.deleteMany({
      where: {
        userId,
        source: 'profile',
        sourceId: 'user_profile',
      },
    });
  }
}
