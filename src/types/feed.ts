import { FeedItemType, FeedItemPriority, FeedItemStatus, ActionType, ActionStyle } from '@prisma/client';

// Re-export Prisma enums for convenience
export { FeedItemType, FeedItemPriority, FeedItemStatus, ActionType, ActionStyle };

/**
 * Data source information for feed items
 */
export interface DataSource {
  type: 'gmail' | 'calendar' | 'notion' | 'drive' | 'custom';
  accountId?: string;
  integrationName?: string;
  sourceUrl?: string; // Deep link to source
}

/**
 * Action configuration for different action types
 */
export interface ActionConfig {
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

/**
 * Context information for feed items
 */
export interface ContextInfo {
  // Time context
  timeRelevance?: 'now' | 'today' | 'this_week' | 'upcoming';
  targetTime?: Date;
  targetType?: 'start' | 'due' | 'deadline' | 'expires';

  // For items with duration
  timeRange?: {
    start: Date;
    end: Date;
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
    role?: string; // 'organizer', 'attendee', 'assignee', etc.
  }[];

  // Project/Category context
  category?: {
    id: string;
    name: string;
    type: 'project' | 'label' | 'folder';
    color?: string;
  };
}

/**
 * Feed item creation input (without DB-generated fields)
 */
export interface CreateFeedItemInput {
  userId: string;
  type: FeedItemType;
  priority: FeedItemPriority;
  timestamp: Date;
  expiresAt?: Date;

  // Core content
  title: string;
  subtitle?: string;
  description?: string;

  // Visual elements
  icon?: string;
  color?: string;
  imageUrl?: string;

  // Source tracking
  source: DataSource;
  sourceId: string;

  // Metadata
  metadataSchema?: string;
  metadata?: Record<string, any>;

  // Context & relationships
  tags?: string[];
  relatedItems?: string[];
  context?: ContextInfo;

  // Actions
  actions?: CreateActionInput[];
}

/**
 * Action creation input
 */
export interface CreateActionInput {
  label: string;
  type: ActionType;
  style?: ActionStyle;
  icon?: string;

  config: ActionConfig;

  // Conditions & feedback
  enabled?: boolean;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;

  // Async action support
  isAsync?: boolean;
  loadingText?: string;
  successMessage?: string;
  errorMessage?: string;
}

/**
 * Interaction creation input
 */
export interface CreateInteractionInput {
  feedItemId: string;
  actionId: string;
  actionType: string;
  result?: 'success' | 'failure' | 'cancelled';
  durationMs?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Feed query options
 */
export interface FeedQueryOptions {
  userId: string;
  status?: FeedItemStatus[];
  priority?: FeedItemPriority[];
  type?: FeedItemType[];
  tags?: string[];
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
  sortBy?: 'timestamp' | 'priority' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Feed item with relations (full object from DB)
 */
export interface FeedItemWithRelations {
  id: string;
  userId: string;
  type: FeedItemType;
  priority: FeedItemPriority;
  timestamp: Date;
  expiresAt: Date | null;

  title: string;
  subtitle: string | null;
  description: string | null;

  icon: string | null;
  color: string | null;
  imageUrl: string | null;

  source: DataSource;
  sourceId: string;

  metadataSchema: string | null;
  metadata: Record<string, any>;

  tags: string[];
  relatedItems: string[];
  context: ContextInfo | null;

  status: FeedItemStatus;
  snoozeUntil: Date | null;

  actions: ActionWithConfig[];
  interactionHistory: InteractionRecord[];

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Action with full config
 */
export interface ActionWithConfig {
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
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interaction record
 */
export interface InteractionRecord {
  id: string;
  feedItemId: string;
  timestamp: Date;
  actionId: string;
  actionType: string;
  result: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  metadata: Record<string, any>;
}
