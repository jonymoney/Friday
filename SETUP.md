# Google OAuth & Calendar Ingestion Setup

## Overview
This application now supports Google OAuth authentication and automatic calendar event ingestion with OpenAI embeddings.

## Environment Setup

Before running the application, you need to configure the following environment variables in `.env`:

### Required Configuration

1. **Google OAuth Credentials**
   - `GOOGLE_CLIENT_ID` - Your Google OAuth 2.0 Client ID
   - `GOOGLE_CLIENT_SECRET` - Your Google OAuth 2.0 Client Secret
   - `GOOGLE_REDIRECT_URI` - OAuth callback URL (default: `http://localhost:3000/auth/callback`)

   To obtain these credentials:
   1. Go to [Google Cloud Console](https://console.cloud.google.com/)
   2. Create a new project or select an existing one
   3. Enable "Google Calendar API" and "Google+ API"
   4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
   5. Set authorized redirect URI to `http://localhost:3000/auth/callback`

2. **JWT Secret**
   - `JWT_SECRET` - A secure random string for signing JWT tokens
   - Generate with: `openssl rand -base64 32`

3. **OpenAI API Key**
   - `OPENAI_API_KEY` - Your OpenAI API key for generating embeddings
   - Get from [OpenAI Platform](https://platform.openai.com/api-keys)

4. **Google Maps API Key (Optional)**
   - `GOOGLE_MAPS_API_KEY` - For real-time directions, traffic, and place search
   - Get from [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)
   - Enable: Directions API, Places API, Geocoding API

5. **Weather API Key (Optional)**
   - `WEATHER_API_KEY` - For weather forecasts
   - Get from [OpenWeatherMap](https://openweathermap.org/api)

## API Endpoints

### Authentication Endpoints

#### `GET /auth/google`
Initiates the Google OAuth flow. Returns an authorization URL.

**Response:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

#### `GET /auth/callback`
OAuth callback endpoint. Exchange authorization code for JWT token.

**Query Parameters:**
- `code` - Authorization code from Google

**Response:**
```json
{
  "message": "Authentication successful",
  "token": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

#### `GET /auth/status`
Check authentication status (requires JWT token).

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "authenticated": true,
  "user": {
    "userId": "uuid",
    "email": "user@example.com"
  },
  "hasGoogleTokens": true
}
```

### Data Ingestion Endpoints

#### `POST /sync/calendar`
Sync Google Calendar events for the authenticated user (requires JWT token).

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Calendar sync completed",
  "processed": 5,
  "errors": 0
}
```

**What it does:**
- Fetches calendar events for the next 7 days
- Generates embeddings for each event using OpenAI
- Stores events with embeddings in the UserContext table

#### `GET /context`
Retrieve user context (calendar events with embeddings).

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "contexts": [
    {
      "id": "uuid",
      "userId": "uuid",
      "source": "google_calendar",
      "content": "Event: Team Meeting\nStart: ...",
      "embedding": [0.123, -0.456, ...],
      "createdAt": "2025-10-09T..."
    }
  ]
}
```

### Search Endpoints

#### `POST /search`
Semantic search on user context using natural language queries.

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "query": "meetings about budget",
  "limit": 10
}
```

**Response:**
```json
{
  "query": "meetings about budget",
  "results": [
    {
      "id": "uuid",
      "userId": "uuid",
      "source": "google_calendar",
      "content": "Event: Q4 Budget Review\nStart: ...",
      "createdAt": "2025-10-09T...",
      "similarity": 0.87
    }
  ],
  "count": 5
}
```

**How it works:**
- Converts your query into an embedding using OpenAI
- Calculates cosine similarity with all stored contexts
- Returns most similar results ranked by similarity score (0-1)

#### `GET /search/recent`
Get recent context from the last 24 hours.

**Headers:**
- `Authorization: Bearer <token>`

**Query Parameters:**
- `limit` - Number of results (default: 10)

**Example:**
```bash
GET /search/recent?limit=10
```

**Response:**
```json
{
  "results": [...],
  "count": 3
}
```

### AI Query Endpoint

#### `POST /query`
Ask questions about your calendar and context using GPT-4.

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "question": "What meetings do I have tomorrow?"
}
```

**Response:**
```json
{
  "question": "What meetings do I have tomorrow?",
  "answer": "Based on your calendar, you have 2 meetings tomorrow: a team standup at 9:00 AM and a client review at 2:00 PM.",
  "sources": [
    {
      "id": "uuid",
      "source": "google_calendar",
      "content": "Event: Team Standup\nStart: 2025-10-10 09:00...",
      "createdAt": "2025-10-09T...",
      "similarity": 0.89
    }
  ]
}
```

**How it works:**
1. Retrieves relevant context using semantic search
2. Includes recent events from last 24 hours
3. Uses GPT-4 with function calling to determine if real-time information is needed
4. Automatically calls external APIs when needed:
   - **Directions & Traffic**: When asked about commute time, how to get somewhere
   - **Weather**: When asked about weather for event locations
   - **Places**: When searching for nearby restaurants, coffee shops, etc.
   - **Current Time**: For time-based calculations
5. Combines context + real-time data to generate comprehensive answer
6. Returns answer with source citations and tools used

**Real-time Information Features:**
The `/query` endpoint now supports function calling with the following tools:

- `get_directions(origin, destination, departure_time)` - Get driving directions with traffic
- `search_places(location, query, radius)` - Find nearby places
- `get_weather(location, date)` - Get weather forecasts
- `get_current_time(timezone)` - Get current date/time

**Example queries that use real-time tools:**
```bash
# Get directions to meeting
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"How long will it take me to get to my next meeting?"}' \
  http://localhost:3000/query

# Check weather
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"What will the weather be like for my hiking event this weekend?"}' \
  http://localhost:3000/query

# Find nearby places
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"Find good coffee shops near my 2pm meeting location"}' \
  http://localhost:3000/query
```

**Response with tools:**
```json
{
  "question": "How long will it take to get to my next meeting?",
  "answer": "Your next meeting is at the office in Bellevue. With current traffic, it will take approximately 35 minutes (15.2 miles). Without traffic it's normally 25 minutes.",
  "sources": [...],
  "toolsUsed": [
    {
      "toolName": "get_directions",
      "result": {
        "origin": "123 Main St, Seattle, WA",
        "destination": "456 Office Ave, Bellevue, WA",
        "distance": "15.2 miles",
        "duration": "25 mins",
        "duration_in_traffic": "35 mins"
      }
    }
  ]
}
```

### User Profile

#### `PUT /profile`
Update user profile with personal information and preferences.

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "name": "John Doe",
  "homeAddress": "123 Main St, Seattle, WA 98101",
  "workAddress": "456 Tech Ave, Bellevue, WA 98004",
  "birthday": "1990-01-15",
  "phone": "+1-206-555-0123",
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

**How it works:**
1. Stores profile data in UserProfile table
2. Formats profile into searchable text
3. Generates embedding for semantic search
4. Creates UserContext entry with source "profile"
5. Profile data becomes available in search, queries, and feed

#### `GET /profile`
Retrieve user profile.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "profile": {
    "name": "John Doe",
    "homeAddress": "123 Main St, Seattle, WA 98101",
    ...
  }
}
```

#### `DELETE /profile`
Delete user profile and associated context.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Profile deleted successfully"
}
```

### Personalized Feed

#### `GET /feed`
Get your personalized daily feed with prioritized items.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "items": [
    {
      "title": "Budget meeting in 2 hours",
      "summary": "Team budget review with Sarah at 2pm, bring Q1 reports",
      "source": "calendar",
      "priority": "high",
      "time": "14:00",
      "createdAt": "2025-10-09T..."
    },
    {
      "title": "Project deadline approaching",
      "summary": "Website redesign due end of week",
      "source": "calendar",
      "priority": "medium",
      "createdAt": "2025-10-09T..."
    }
  ],
  "count": 2,
  "generatedAt": "2025-10-09T12:00:00.000Z"
}
```

**How it works:**
1. Gathers today's upcoming events (next 24 hours)
2. Includes recent context from past 24 hours
3. Uses GPT-4 to analyze, rank, and summarize items
4. Returns 5-10 most important items prioritized by urgency
5. Assigns priority levels: high (urgent), medium (relevant), low (nice to know)

**Priority Logic:**
- **High**: Urgent meetings/events in next few hours, time-sensitive items
- **Medium**: Relevant upcoming events, important recent items
- **Low**: Background information, nice-to-know updates

## Testing the Flow

1. **Start the server:**
   ```bash
   npm run dev
   ```

2. **Initiate OAuth flow:**
   ```bash
   curl http://localhost:3000/auth/google
   ```
   Visit the returned `authUrl` in your browser.

3. **After authorization, you'll be redirected to `/auth/callback`**
   Save the `token` from the response.

4. **Check auth status:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/auth/status
   ```

5. **Sync calendar:**
   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/sync/calendar
   ```

6. **View ingested context:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/context
   ```

7. **Search your context:**
   ```bash
   # Semantic search
   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"query":"meetings about budget","limit":5}' \
     http://localhost:3000/search

   # Get recent context (last 24h)
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/search/recent?limit=10
   ```

8. **Ask questions using AI:**
   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"question":"What meetings do I have tomorrow?"}' \
     http://localhost:3000/query
   ```

9. **Get your personalized feed:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/feed
   ```

## Database Schema

### User Table
- `id` - UUID (primary key)
- `email` - String (unique)
- `googleTokens` - JSON (encrypted OAuth tokens)
- `createdAt` - DateTime

### UserProfile Table
- `id` - UUID (primary key)
- `userId` - UUID (foreign key to User, unique)
- `data` - JSON (flexible profile data)
- `createdAt` - DateTime
- `updatedAt` - DateTime

### UserContext Table
- `id` - UUID (primary key)
- `userId` - UUID (foreign key to User)
- `source` - String (e.g., "google_calendar", "profile")
- `content` - String (formatted event text)
- `embedding` - JSON array (1536-dimension vector)
- `createdAt` - DateTime

## Architecture Notes

### Services

**`src/services/auth.ts`**
- Google OAuth flow management
- JWT token generation and validation
- User token storage and refresh

**`src/services/ingestion.ts`**
- Calendar event fetching
- OpenAI embedding generation
- Data storage in PostgreSQL

**`src/services/vectorStore.ts`**
- Semantic search using cosine similarity
- Recent context retrieval (last 24 hours)

**`src/services/agent.ts`**
- AI-powered question answering using GPT-4 with function calling
- Context retrieval and formatting
- Real-time information integration via tools
- Source citation

**`src/services/tools.ts`**
- External API integration layer
- Google Maps Directions API for traffic and directions
- Google Places API for nearby place search
- OpenWeatherMap API for weather forecasts
- Function calling tool definitions and execution

**`src/services/feed.ts`**
- Personalized feed generation
- Smart prioritization using GPT-4
- Aggregates today's events and recent context

**`src/services/profile.ts`**
- User profile management
- Automatic context generation from profile data
- Searchable profile embedding

**`src/middleware/auth.ts`**
- JWT token verification middleware
- Request authentication

### Security Considerations

**Current Implementation (Development):**
- OAuth tokens stored as plain JSON in database
- JWT tokens returned in response body

**Production Recommendations:**
1. Encrypt OAuth tokens before storing (use crypto library)
2. Use httpOnly cookies for JWT tokens
3. Implement token rotation
4. Add rate limiting
5. Use HTTPS only
6. Implement CORS properly
7. Add request validation middleware

## Search Algorithm Details

### Cosine Similarity
The semantic search uses cosine similarity to compare embeddings:

```
similarity = (A · B) / (||A|| × ||B||)
```

Where:
- A is the query embedding
- B is the stored context embedding
- Results range from -1 (opposite) to 1 (identical)
- Higher scores indicate more semantic similarity

## Performance Notes

**Current Implementation:**
- Embeddings stored as JSON (1536 dimensions)
- Similarity calculated in-memory using JavaScript
- Works well for < 1000 contexts per user

**For Production/Scale:**
- Enable pgvector extension for native vector operations
- Use native SQL vector similarity: `embedding <=> query_embedding`
- Add indexes on vector columns
- Implement pagination for large result sets

## Future Enhancements

1. ~~**Semantic Search**~~ ✅ **Implemented**
2. ~~**Real-time Information Access**~~ ✅ **Implemented** (Directions, Weather, Places)
3. **Native pgvector**: Migrate to native vector type for better performance
4. **Additional Sources**: Gmail, Drive, Slack ingestion
5. **Batch Processing**: Background job for periodic sync
6. **Webhook Support**: Real-time calendar updates
7. **User Dashboard**: Frontend UI
8. **Additional Tools**: Flight status, public transit, restaurant reservations
