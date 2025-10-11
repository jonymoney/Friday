# Monday API - Personal Context Management System

A TypeScript Express API that provides personalized AI assistance by managing user context from multiple sources (Calendar, Gmail, Profile) with semantic search capabilities using OpenAI embeddings.

## Overview

Monday API is an intelligent personal assistant backend that:
- **Ingests** data from Google Calendar and Gmail
- **Stores** user profile information and preferences
- **Generates** semantic embeddings for intelligent search
- **Provides** AI-powered query responses using RAG (Retrieval Augmented Generation)
- **Delivers** personalized daily feeds based on user context

## Architecture

### Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (Railway-hosted) with pgvector extension
- **ORM**: Prisma
- **AI/ML**: OpenAI API (GPT-4 & text-embedding-3-small)
- **Authentication**: Google OAuth 2.0 + JWT
- **External APIs**:
  - Google Calendar API
  - Gmail API
  - Google Routes API (New)
  - Google Places API (New)
  - OpenWeatherMap API

### System Architecture

```
┌─────────────────┐
│   Client App    │
│  (Frontend/API) │
└────────┬────────┘
         │ JWT Auth
         ▼
┌─────────────────────────────────────────┐
│          Express API Server             │
│  ┌───────────────────────────────────┐  │
│  │    Authentication Layer            │  │
│  │  - Google OAuth 2.0                │  │
│  │  - JWT Token Management            │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │    Ingestion Services              │  │
│  │  - Calendar Sync                   │  │
│  │  - Gmail Sync                      │  │
│  │  - Profile Management              │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │    AI Services                     │  │
│  │  - Agent Service (RAG)             │  │
│  │  - Vector Store                    │  │
│  │  - Tool Service (Real-time APIs)   │  │
│  │  - Feed Generator                  │  │
│  └───────────────────────────────────┘  │
└──────────┬──────────────────────────────┘
           │
    ┌──────┴───────┐
    │              │
    ▼              ▼
┌──────────┐  ┌──────────┐
│PostgreSQL│  │ OpenAI   │
│+ pgvector│  │   API    │
└──────────┘  └──────────┘
```

### Data Flow

1. **User Authentication**
   - User authenticates via Google OAuth
   - Server issues JWT token for subsequent requests

2. **Data Ingestion**
   - User triggers sync endpoints
   - System fetches data from Google APIs
   - Content is formatted and embedded using OpenAI
   - Stored in PostgreSQL with deduplication

3. **Query Processing**
   - User asks a question
   - System generates embedding for query
   - Performs semantic search against stored context
   - Agent uses GPT-4 with retrieved context and real-time tools
   - Returns intelligent response

## Database Schema

### Models

**User**
- `id` (UUID)
- `email` (unique)
- `googleTokens` (JSON) - OAuth tokens
- `createdAt`
- Relations: `contexts[]`, `profile`

**UserProfile**
- `id` (UUID)
- `userId` (unique, FK to User)
- `data` (JSON) - Flexible profile data
- `createdAt`, `updatedAt`

**UserContext**
- `id` (UUID)
- `userId` (FK to User)
- `source` (string) - 'google_calendar', 'gmail', 'profile'
- `sourceId` (string, nullable) - External ID for deduplication
- `content` (text) - Human-readable content
- `embedding` (JSON) - 1536-dimensional vector
- `createdAt`, `updatedAt`
- Unique constraint: `[userId, source, sourceId]`

### Deduplication Strategy

The system prevents duplicate entries using a composite unique constraint:
- Calendar events: Uses Google Calendar event ID
- Gmail messages: Uses Gmail message ID
- Profile: Uses fixed ID 'user_profile'

Updates trigger `upsert` operations that update existing records rather than creating duplicates.

## API Endpoints

### Authentication

#### `GET /auth/google`
Get Google OAuth authorization URL.

**Response:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

#### `GET /auth/callback?code=...`
Handle OAuth callback and exchange code for tokens.

**Response:**
```json
{
  "message": "Authentication successful",
  "token": "jwt_token_here",
  "user": {
    "id": "user_uuid",
    "email": "user@example.com"
  }
}
```

#### `GET /auth/status`
Check current authentication status.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "authenticated": true,
  "user": { "userId": "...", "email": "..." },
  "hasGoogleTokens": true
}
```

### Data Ingestion

#### `POST /sync/calendar`
Sync Google Calendar events from the next 7 days.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Calendar sync completed",
  "processed": 5,
  "errors": 0
}
```

#### `POST /sync/emails`
Sync Gmail messages from the last 7 days.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Gmail sync completed",
  "processed": 42,
  "errors": 0
}
```

### Profile Management

#### `PUT /profile`
Update user profile with personal information.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "John Doe",
  "birthday": "1990-01-01",
  "homeAddress": "123 Main St, Seattle, WA",
  "workAddress": "456 Office Blvd, Bellevue, WA",
  "phone": "+1-555-0123",
  "preferences": {
    "dietaryRestrictions": ["vegetarian"],
    "commuteMethod": "car",
    "timezone": "America/Los_Angeles"
  }
}
```

**Response:**
```json
{
  "message": "Profile updated successfully",
  "profile": { ... }
}
```

#### `GET /profile`
Retrieve user profile.

#### `DELETE /profile`
Delete user profile and associated context.

### Search & Context

#### `POST /search`
Semantic search across user context.

**Request Body:**
```json
{
  "query": "What meetings do I have this week?",
  "limit": 10
}
```

**Response:**
```json
{
  "query": "What meetings do I have this week?",
  "results": [
    {
      "id": "...",
      "source": "google_calendar",
      "content": "Event: Team Standup...",
      "similarity": 0.89
    }
  ],
  "count": 5
}
```

#### `GET /search/recent?limit=10`
Get recent context entries.

#### `GET /context`
Get all user context (for debugging).

### AI Agent

#### `POST /query`
Ask the AI agent a question. The agent uses RAG to retrieve relevant context and can call real-time tools.

**Request Body:**
```json
{
  "question": "How long will my commute to work take tomorrow morning?"
}
```

**Response:**
```json
{
  "question": "How long will my commute to work take tomorrow morning?",
  "answer": "Based on your profile, your commute from 123 Main St to 456 Office Blvd will take approximately 35 minutes with current traffic conditions...",
  "sources": [
    { "id": "...", "source": "profile", "content": "..." }
  ],
  "toolsUsed": ["get_directions"]
}
```

#### Available Tools
- `get_directions` - Get driving directions with real-time traffic
- `search_places` - Find nearby places (restaurants, coffee shops, etc.)
- `get_weather` - Get weather forecast for specific location and date
- `get_current_time` - Get current date and time

### Personalized Feed

#### `GET /feed`
Get a personalized daily feed with recommendations.

**Response:**
```json
{
  "items": [
    {
      "type": "morning_prep",
      "title": "🌅 Morning Preparation",
      "sections": [...]
    },
    {
      "type": "calendar",
      "title": "📅 Today's Schedule",
      "sections": [...]
    }
  ],
  "count": 5,
  "generatedAt": "2025-10-11T20:00:00Z"
}
```

## Development

### Prerequisites

- Node.js 18+
- PostgreSQL with pgvector extension
- Google Cloud Project with OAuth credentials
- OpenAI API key
- OpenWeatherMap API key (optional)

### Environment Variables

Create a `.env` file in the root directory:

```env
# Server
PORT=3000

# Database (PostgreSQL with pgvector)
DATABASE_URL="postgresql://user:password@host:port/database"

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# JWT Secret (generate a secure random string)
JWT_SECRET=your_jwt_secret_here

# OpenAI API Key
OPENAI_API_KEY=sk-...

# Google Maps API Key (for real-time tools)
GOOGLE_MAPS_API_KEY=AIza...

# OpenWeatherMap API Key (for weather forecasts)
WEATHER_API_KEY=...
```

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Push schema to database
npx prisma db push

# Or create a migration
npx prisma migrate dev --name init
```

### Running the Application

```bash
# Development (with hot reload)
npm run dev

# Build
npm run build

# Production
npm start
```

### Database Management

```bash
# Open Prisma Studio (GUI)
npx prisma studio

# Create migration
npx prisma migrate dev --name migration_name

# Apply migrations (production)
npx prisma migrate deploy

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

## Key Features

### 1. Deduplication System
Prevents duplicate entries using composite unique constraints on `[userId, source, sourceId]`. Subsequent syncs update existing records rather than creating duplicates.

### 2. Semantic Search
Uses OpenAI's `text-embedding-3-small` (1536 dimensions) to generate embeddings for all content. Enables intelligent similarity-based search across all user data.

### 3. RAG (Retrieval Augmented Generation)
Agent retrieves relevant context before answering questions, ensuring responses are grounded in user's actual data rather than hallucinations.

### 4. Real-time Tools
Agent can call external APIs for up-to-date information:
- Traffic and directions
- Weather forecasts
- Place searches

### 5. Personalized Feed
Generates daily feed with:
- Morning preparation tips
- Today's schedule
- Smart commute planning
- Weather-aware recommendations
- Contextual suggestions

## Security Considerations

### Current Implementation (Development)
- OAuth tokens stored as JSON in database (plaintext)
- JWT secret in environment variable
- API keys in `.env` file

### Production Recommendations
1. **Encrypt OAuth tokens** before storing
2. **Use secrets manager** (AWS Secrets Manager, GCP Secret Manager)
3. **Implement token rotation**
4. **Add rate limiting**
5. **Enable HTTPS only**
6. **Sanitize user inputs**
7. **Add CORS restrictions**
8. **Implement proper logging** (exclude sensitive data)

## Future Enhancements

- [ ] Enable pgvector extension for native vector storage
- [ ] Add more data sources (Slack, Email, etc.)
- [ ] Implement batch processing for large syncs
- [ ] Add webhook support for real-time updates
- [ ] Implement caching layer (Redis)
- [ ] Add user preferences for sync frequency
- [ ] Support multiple calendar/email accounts
- [ ] Add conversation history for multi-turn dialogues
- [ ] Implement vector index optimization
- [ ] Add analytics and insights dashboard

## License

ISC

## Contributing

Contributions welcome! Please open an issue or PR.
