# Feed API Specification for Frontend

## Overview

The Feed API provides a personalized feed system with two-step architecture:
1. **Generation** (slow, backend/cron): Processes user context and creates feed items
2. **Retrieval** (fast, frontend): Returns stored feed items instantly

## Base URL
```
http://localhost:3000/api
```

## Authentication

All endpoints require JWT authentication via Bearer token:

```
Authorization: Bearer <jwt_token>
```

---

## Endpoints

### 1. Get Feed Items (Fast - Use this in frontend)

**Endpoint:** `GET /feed`

**Description:** Retrieves stored feed items from database. This is FAST (instant) and should be used by clients for displaying the feed.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | No | 50 | Maximum number of items to return |
| `offset` | number | No | 0 | Pagination offset |
| `includeExpired` | boolean | No | false | Include expired items |

**Response:** `200 OK`

```typescript
{
  items: FeedItem[];
  count: number;
  limit: number;
  offset: number;
}
```

**Example Request:**
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/feed?limit=10&offset=0"
```

**Example Response:**
```json
{
  "items": [
    {
      "id": "9450adcf-e99e-49c1-9547-6364baf3146f",
      "userId": "58d805a3-aa1f-4523-8586-d1b4a50959de",
      "type": "TASK",
      "priority": "MEDIUM",
      "timestamp": "2025-10-07T17:26:15.000Z",
      "expiresAt": "2025-10-17T01:14:13.214Z",
      "title": "Provide Feedback to Progressive",
      "subtitle": null,
      "description": "Progressive requests feedback about your recent motorcycle insurance quote.",
      "icon": null,
      "color": null,
      "imageUrl": null,
      "source": {
        "type": "gmail",
        "accountId": "58d805a3-aa1f-4523-8586-d1b4a50959de",
        "integrationName": "gmail",
        "sourceUrl": "https://mail.google.com/mail/u/0/#inbox/..."
      },
      "sourceId": "gmail-fb2e45ab-f2fd-47e7-8ecd-171ff65ce9d0",
      "metadataSchema": null,
      "metadata": {},
      "tags": ["gmail"],
      "relatedItems": [],
      "context": null,
      "status": "NEW",
      "snoozeUntil": null,
      "createdAt": "2025-10-16T01:14:49.585Z",
      "updatedAt": "2025-10-16T01:14:49.585Z",
      "actions": [],
      "interactionHistory": []
    }
  ],
  "count": 1,
  "limit": 10,
  "offset": 0
}
```

---

### 2. Generate Feed Items (Slow - Backend/Cron only)

**Endpoint:** `POST /feed/generate`

**Description:** Processes unprocessed user context and generates new feed items. This is SLOW (~30-60 seconds) and should be triggered by backend cron jobs, not directly by frontend.

**Response:** `200 OK`

```typescript
{
  message: string;
  generated: number;
  skipped: number;
  errors: number;
  total: number;
}
```

**Example Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/feed/generate
```

**Example Response:**
```json
{
  "message": "Feed generation completed",
  "generated": 15,
  "skipped": 0,
  "errors": 0,
  "total": 15
}
```

**Note:** Only call this endpoint when:
- User manually triggers "Refresh Feed"
- Backend cron job runs (recommended: every 15-30 minutes)
- After syncing new data (calendar, emails, etc.)

---

### 3. Update Feed Item Status

**Endpoint:** `PATCH /feed/:feedItemId/status`

**Description:** Update the status of a feed item (e.g., mark as viewed, dismiss, snooze)

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `feedItemId` | string | Yes | UUID of the feed item |

**Request Body:**

```typescript
{
  status: FeedItemStatus;  // Required
  snoozeUntil?: string;    // ISO 8601 date string, required if status is SNOOZED
}
```

**Response:** `200 OK`

```typescript
{
  message: string;
  item: FeedItem;
}
```

**Example Request:**
```bash
# Mark as viewed
curl -X PATCH \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "VIEWED"}' \
  http://localhost:3000/api/feed/9450adcf-e99e-49c1-9547-6364baf3146f/status

# Snooze until tomorrow
curl -X PATCH \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "SNOOZED", "snoozeUntil": "2025-10-17T09:00:00Z"}' \
  http://localhost:3000/api/feed/9450adcf-e99e-49c1-9547-6364baf3146f/status

# Dismiss
curl -X PATCH \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "DISMISSED"}' \
  http://localhost:3000/api/feed/9450adcf-e99e-49c1-9547-6364baf3146f/status
```

---

### 4. Record Interaction

**Endpoint:** `POST /feed/:feedItemId/interaction`

**Description:** Track user interactions with feed item actions (e.g., clicked button, completed task)

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `feedItemId` | string | Yes | UUID of the feed item |

**Request Body:**

```typescript
{
  actionId: string;        // Required - ID of the action that was triggered
  actionType: string;      // Required - Type of action (e.g., "NAVIGATE", "DISMISS")
  result?: 'success' | 'failure' | 'cancelled';  // Optional
  durationMs?: number;     // Optional - How long the action took
  errorMessage?: string;   // Optional - Error message if action failed
}
```

**Response:** `200 OK`

```typescript
{
  message: string;
  interaction: Interaction;
}
```

**Example Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "action-1",
    "actionType": "NAVIGATE",
    "result": "success",
    "durationMs": 150
  }' \
  http://localhost:3000/api/feed/9450adcf-e99e-49c1-9547-6364baf3146f/interaction
```

---

## TypeScript Types

### Core Types

```typescript
type FeedItemType =
  | 'CALENDAR_EVENT'
  | 'EMAIL'
  | 'TASK'
  | 'REMINDER'
  | 'NOTIFICATION'
  | 'ARTICLE'
  | 'SUGGESTION'
  | 'ALERT'
  | 'ACHIEVEMENT'
  | 'CUSTOM';

type FeedItemPriority =
  | 'URGENT'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW';

type FeedItemStatus =
  | 'NEW'
  | 'VIEWED'
  | 'ACTED'
  | 'DISMISSED'
  | 'SNOOZED'
  | 'COMPLETED'
  | 'EXPIRED';

type ActionType =
  | 'NAVIGATE'
  | 'API_CALL'
  | 'MODAL'
  | 'INLINE'
  | 'AI_ACTION'
  | 'DISMISS'
  | 'SNOOZE'
  | 'COMPLETE'
  | 'SHARE'
  | 'CUSTOM';

type ActionStyle =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'DANGER'
  | 'SUCCESS';
```

### Data Structures

```typescript
interface DataSource {
  type: 'gmail' | 'calendar' | 'notion' | 'drive' | 'custom';
  accountId?: string;
  integrationName?: string;
  sourceUrl?: string; // Deep link to original source
}

interface ActionConfig {
  // Navigate
  url?: string;
  openInNewTab?: boolean;

  // API Call
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  payload?: Record<string, any>;
  headers?: Record<string, string>;

  // Modal
  modalType?: string;
  modalProps?: Record<string, any>;

  // Inline Action
  handler?: string;
  params?: Record<string, any>;
  onSuccess?: string;
  onError?: string;
  optimisticUpdate?: boolean;

  // AI Action
  aiPrompt?: string;
  aiContext?: Record<string, any>;
}

interface Action {
  id: string;
  feedItemId: string;
  label: string;
  type: ActionType;
  style: ActionStyle;
  icon: string | null;
  config: ActionConfig;
  enabled: boolean;
  requiresConfirmation: boolean;
  confirmationMessage: string | null;
  isAsync: boolean;
  loadingText: string | null;
  successMessage: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Interaction {
  id: string;
  feedItemId: string;
  timestamp: string;
  actionId: string;
  actionType: string;
  result: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  metadata: Record<string, any>;
}

interface ContextInfo {
  // Time context
  timeRelevance?: 'now' | 'today' | 'this_week' | 'upcoming';
  targetTime?: string;
  targetType?: 'start' | 'due' | 'deadline' | 'expires';

  timeRange?: {
    start: string;
    end: string;
  };

  // Location context
  location?: {
    name: string;
    address?: string;
    coordinates?: { lat: number; lng: number };
    distance?: number;
  };

  // People context
  people?: {
    id: string;
    name: string;
    email?: string;
    avatar?: string;
    role?: string;
  }[];

  // Project/Category context
  category?: {
    id: string;
    name: string;
    type: 'project' | 'label' | 'folder';
    color?: string;
  };
}

interface FeedItem {
  id: string;
  userId: string;
  type: FeedItemType;
  priority: FeedItemPriority;
  timestamp: string; // ISO 8601
  expiresAt: string | null; // ISO 8601

  // Core content
  title: string;
  subtitle: string | null;
  description: string | null;

  // Visual elements
  icon: string | null;
  color: string | null;
  imageUrl: string | null;

  // Source tracking
  source: DataSource;
  sourceId: string;

  // Metadata
  metadataSchema: string | null;
  metadata: Record<string, any>;

  // Context & relationships
  tags: string[];
  relatedItems: string[]; // Array of FeedItem IDs
  context: ContextInfo | null;

  // User interaction
  status: FeedItemStatus;
  snoozeUntil: string | null; // ISO 8601

  // Relations
  actions: Action[];
  interactionHistory: Interaction[];

  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

---

## Error Responses

All endpoints may return the following error responses:

**401 Unauthorized**
```json
{
  "error": "No token provided"
}
```
```json
{
  "error": "Invalid token"
}
```
```json
{
  "error": "Token expired"
}
```

**400 Bad Request**
```json
{
  "error": "Status is required"
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to retrieve feed items"
}
```

---

## Frontend Implementation Guide

### 1. Fetching the Feed

```typescript
async function getFeed(limit = 50, offset = 0): Promise<FeedItem[]> {
  const response = await fetch(
    `http://localhost:3000/api/feed?limit=${limit}&offset=${offset}`,
    {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch feed');
  }

  const data = await response.json();
  return data.items;
}
```

### 2. Marking Item as Viewed

```typescript
async function markAsViewed(feedItemId: string): Promise<void> {
  await fetch(
    `http://localhost:3000/api/feed/${feedItemId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'VIEWED' }),
    }
  );
}
```

### 3. Dismissing an Item

```typescript
async function dismissItem(feedItemId: string): Promise<void> {
  await fetch(
    `http://localhost:3000/api/feed/${feedItemId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'DISMISSED' }),
    }
  );
}
```

### 4. Snoozing an Item

```typescript
async function snoozeItem(
  feedItemId: string,
  snoozeUntil: Date
): Promise<void> {
  await fetch(
    `http://localhost:3000/api/feed/${feedItemId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'SNOOZED',
        snoozeUntil: snoozeUntil.toISOString(),
      }),
    }
  );
}
```

### 5. Executing an Action

```typescript
async function executeAction(
  feedItem: FeedItem,
  action: Action
): Promise<void> {
  const startTime = Date.now();

  try {
    // Handle different action types
    switch (action.type) {
      case 'NAVIGATE':
        if (action.config.url) {
          if (action.config.openInNewTab) {
            window.open(action.config.url, '_blank');
          } else {
            window.location.href = action.config.url;
          }
        }
        break;

      case 'DISMISS':
        await dismissItem(feedItem.id);
        break;

      case 'SNOOZE':
        // Show snooze picker, then:
        const snoozeDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
        await snoozeItem(feedItem.id, snoozeDate);
        break;

      case 'COMPLETE':
        await fetch(
          `http://localhost:3000/api/feed/${feedItem.id}/status`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${getAuthToken()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'COMPLETED' }),
          }
        );
        break;

      // Add more action types as needed
    }

    // Record the interaction
    await fetch(
      `http://localhost:3000/api/feed/${feedItem.id}/interaction`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actionId: action.id,
          actionType: action.type,
          result: 'success',
          durationMs: Date.now() - startTime,
        }),
      }
    );
  } catch (error) {
    // Record failed interaction
    await fetch(
      `http://localhost:3000/api/feed/${feedItem.id}/interaction`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actionId: action.id,
          actionType: action.type,
          result: 'failure',
          durationMs: Date.now() - startTime,
          errorMessage: error.message,
        }),
      }
    );

    throw error;
  }
}
```

### 6. Refreshing Feed (Manual)

```typescript
async function refreshFeed(): Promise<void> {
  // Show loading state
  setLoading(true);

  try {
    // Trigger generation (this is slow!)
    await fetch('http://localhost:3000/api/feed/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
      },
    });

    // Fetch updated feed
    const items = await getFeed();
    setFeedItems(items);
  } finally {
    setLoading(false);
  }
}
```

---

## Best Practices

### 1. Polling Strategy
- **Don't poll `/feed/generate`** - It's too slow
- **Poll `/feed` every 30-60 seconds** for new items
- Or use WebSocket/Server-Sent Events for real-time updates

### 2. Optimistic UI Updates
- Update UI immediately when user dismisses/snoozes
- Revert if API call fails
- Use `action.config.optimisticUpdate` flag

### 3. Action Confirmation
- Check `action.requiresConfirmation` before executing
- Show modal with `action.confirmationMessage`

### 4. Async Actions
- Check `action.isAsync` for long-running actions
- Show `action.loadingText` during execution
- Display `action.successMessage` or `action.errorMessage`

### 5. Priority-based Styling
- `URGENT`: Red/critical styling
- `HIGH`: Orange/warning styling
- `MEDIUM`: Default styling
- `LOW`: Muted/secondary styling

### 6. Pagination
- Use `limit` and `offset` for infinite scroll
- Default limit of 50 is reasonable
- Cache fetched items to reduce API calls

### 7. Status Management
- Mark items as `VIEWED` when user sees them
- Allow users to restore dismissed items (query with all statuses)
- Show snooze badge for snoozed items

---

## React Example Component

```typescript
import { useState, useEffect } from 'react';

function FeedComponent() {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFeed();

    // Poll every 60 seconds
    const interval = setInterval(loadFeed, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadFeed() {
    try {
      const items = await getFeed(50, 0);
      setFeedItems(items);
    } catch (error) {
      console.error('Failed to load feed:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss(itemId: string) {
    // Optimistic update
    setFeedItems(prev => prev.filter(item => item.id !== itemId));

    try {
      await dismissItem(itemId);
    } catch (error) {
      // Revert on error
      loadFeed();
    }
  }

  return (
    <div className="feed">
      {feedItems.map(item => (
        <FeedItemCard
          key={item.id}
          item={item}
          onDismiss={handleDismiss}
          onAction={(action) => executeAction(item, action)}
        />
      ))}
    </div>
  );
}
```

---

## Questions or Issues?

Contact backend team or refer to:
- `/src/services/feed.ts` - Service implementation
- `/src/types/feed.ts` - TypeScript types
- `/prisma/schema.prisma` - Database schema
