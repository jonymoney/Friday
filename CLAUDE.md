# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript Express API with PostgreSQL database using Prisma ORM. The project is designed for storing and managing user context data with vector embeddings support (pgvector extension).

## Development Commands

### Running the application
- `npm run dev` - Start development server with hot reload using tsx watch
- `npm run build` - Compile TypeScript to JavaScript (outputs to dist/)
- `npm start` - Run the compiled production build

### Database commands
- `npx prisma generate` - Generate Prisma Client after schema changes
- `npx prisma migrate dev` - Create and apply migrations in development
- `npx prisma migrate deploy` - Apply migrations in production
- `npx prisma studio` - Open Prisma Studio GUI for database exploration
- `npx prisma db push` - Push schema changes directly to database without migrations

## Architecture

### Database Layer
- **Prisma ORM**: Handles all database interactions through type-safe Prisma Client
- **PostgreSQL with pgvector**: Remote Railway-hosted database with vector extension enabled for embeddings
- **Schema location**: `prisma/schema.prisma`
- Single model `UserContext` with vector embeddings field (1536 dimensions)

### Application Entry Point
- `src/index.ts` - Express server initialization, Prisma client setup, and graceful shutdown handling
- Single health check endpoint at `/health` that validates database connectivity

### Environment Configuration
- All configuration via `.env` file
- Required variables: `DATABASE_URL` (Prisma connection string), optional `PORT` (defaults to 3000)
- Database credentials are for Railway-hosted PostgreSQL instance

### Key Architectural Notes
- Prisma Client is instantiated once at application startup and shared across requests
- Graceful shutdown handler properly disconnects Prisma on SIGINT
- The codebase uses PostgreSQL's vector extension for embeddings - ensure this is enabled when working with the database
- Generated Prisma client is excluded from git (see .gitignore)
