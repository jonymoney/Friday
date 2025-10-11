import OpenAI from 'openai';
import { VectorStore } from './vectorStore';
import { ToolService, ToolResult } from './tools';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class AgentService {
  /**
   * Answer a question using relevant context from user's stored data
   * Now enhanced with function calling for real-time information
   */
  static async answerQuestion(
    userId: string,
    question: string
  ): Promise<{ answer: string; sources: any[]; toolsUsed?: ToolResult[] }> {
    // 1. Get relevant context using semantic search
    const semanticResults = await VectorStore.searchSimilar(userId, question, 5);

    // 2. Get recent context (last 24h)
    const recentResults = await VectorStore.getRecentContext(userId, 3);

    // 3. Combine and deduplicate
    const seenIds = new Set<string>();
    const allContext: any[] = [];

    [...semanticResults, ...recentResults].forEach((result) => {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        allContext.push(result);
      }
    });

    // 4. Format context for prompt
    const contextText = allContext
      .map((ctx, idx) => {
        return `[${idx + 1}] Source: ${ctx.source}\n${ctx.content}\n`;
      })
      .join('\n');

    // 5. Build prompt with function calling
    const currentTime = new Date().toISOString();
    const systemPrompt = `You are a helpful AI assistant that answers questions based on the user's calendar events and personal context.

Current time: ${currentTime}

You have access to real-time tools for:
- Getting directions and traffic information
- Searching for nearby places (restaurants, coffee shops, etc.)
- Checking weather forecasts
- Getting current time

Important instructions:
- First check if the provided context has relevant information
- If you need real-time information (directions, weather, places, etc.), use the available tools
- Be concise and direct
- Include relevant details like times, dates, locations, and attendees when applicable
- If asked about future events, consider the current time when answering`;

    const userPrompt = `User context from calendar and other sources:

${contextText}

Question: ${question}`;

    // 6. Call GPT-4 with function calling enabled
    const tools = ToolService.getAvailableTools().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const toolsUsed: ToolResult[] = [];
    let finalAnswer = '';

    // Allow up to 3 iterations of function calling
    for (let iteration = 0; iteration < 3; iteration++) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 800,
      });

      const message = completion.choices[0].message;

      // If no tool calls, we have the final answer
      if (!message.tool_calls || message.tool_calls.length === 0) {
        finalAnswer = message.content || 'Unable to generate answer.';
        break;
      }

      // Execute all tool calls
      messages.push(message);

      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log(`Calling tool: ${functionName}`, functionArgs);

        const toolResult = await ToolService.executeTool(functionName, functionArgs);
        toolsUsed.push(toolResult);

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult.result),
        });
      }
    }

    // 7. Return answer with sources and tools used
    return {
      answer: finalAnswer,
      sources: allContext.map((ctx) => ({
        id: ctx.id,
        source: ctx.source,
        content: ctx.content.substring(0, 200) + '...',
        createdAt: ctx.createdAt,
        similarity: ctx.similarity,
      })),
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
  }

  /**
   * Answer a question with streaming response
   */
  static async answerQuestionStream(
    userId: string,
    question: string
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    // Get relevant context
    const semanticResults = await VectorStore.searchSimilar(userId, question, 5);
    const recentResults = await VectorStore.getRecentContext(userId, 3);

    // Combine and deduplicate
    const seenIds = new Set<string>();
    const allContext: any[] = [];

    [...semanticResults, ...recentResults].forEach((result) => {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        allContext.push(result);
      }
    });

    // Format context
    const contextText = allContext
      .map((ctx, idx) => {
        return `[${idx + 1}] Source: ${ctx.source}\n${ctx.content}\n`;
      })
      .join('\n');

    // Build prompt
    const currentTime = new Date().toISOString();
    const systemPrompt = `You are a helpful AI assistant that answers questions based on the user's calendar events and personal context.

Current time: ${currentTime}

Important instructions:
- Answer based ONLY on the provided context below
- If the context doesn't contain enough information to answer, say so honestly
- Be concise and direct
- Include relevant details like times, dates, locations, and attendees when applicable
- If asked about future events, consider the current time when answering`;

    const userPrompt = `User context from calendar and other sources:

${contextText}

Question: ${question}

Answer based only on the provided context above.`;

    // Call GPT-4 with streaming
    const stream = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
    });

    return stream;
  }
}
