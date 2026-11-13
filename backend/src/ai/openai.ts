/**
 * Asking OpenAI for Seri's reply, streamed - A11, docs/AI-AGENT.md section 1.
 *
 * The one place the relay reaches OpenAI. Asked exactly as the answer test set
 * asks (`evals/run.ts`): her model, the five actions as tools, one action at
 * most, the shared prompt cached. What comes back is turned into two kinds of
 * event - words as they are written, and the action once it is whole - so the
 * conversation (conversation.ts) is tested with a fake in its place.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ACTION_TOOLS } from './actions';
import { PROMPT_CACHE_KEY, SERI_MODEL } from './model';

/** A tool call, whole: its id, which action, and the arguments as OpenAI wrote them. */
export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ModelEvent = { type: 'text'; text: string } | { type: 'tool'; call: ModelToolCall };

export interface SeriModel {
  /** Her reply to the conversation so far, as it is written. Stops - it may throw - when `signal` aborts. */
  reply(messages: ChatCompletionMessageParam[], signal: AbortSignal): AsyncIterable<ModelEvent>;
}

/** Replies are a sentence or two; this only stops a runaway one. */
const MAX_REPLY_TOKENS = 300;

/**
 * OpenAI's failure as the relay logs it (`ai_relay.model_failed`, A12): its
 * status and code, never its message - a refused key comes back quoted in it,
 * partly hidden. Being stopped on purpose is left as it is.
 */
export function plainError(err: unknown): unknown {
  if (err instanceof OpenAI.APIUserAbortError) return err;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new Error('OpenAI timed out');
  if (err instanceof OpenAI.APIConnectionError) return new Error('OpenAI could not be reached');
  if (err instanceof OpenAI.APIError) return new Error(['OpenAI', err.status, err.code ?? err.type].filter(Boolean).join(' '));
  return err;
}

export function openAiModel(apiKey: string): SeriModel {
  // Made on the first call, not at start-up: without a key no call reaches her
  // (A13), and the API starts all the same.
  let client: OpenAI | null = null;
  return {
    async *reply(messages, signal) {
      // No retries: a second try is seconds of silence on a live call. A
      // failure ends her part with the fallback instead (A12).
      client ??= new OpenAI({ apiKey, timeout: 15_000, maxRetries: 0 });
      const calls: ModelToolCall[] = [];
      try {
        const stream = await client.chat.completions.create(
          {
            model: SERI_MODEL,
            messages,
            tools: ACTION_TOOLS,
            parallel_tool_calls: false,
            stream: true,
            max_completion_tokens: MAX_REPLY_TOKENS,
            prompt_cache_key: PROMPT_CACHE_KEY,
          },
          { signal }
        );
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) yield { type: 'text', text: delta.content };
          for (const part of delta?.tool_calls ?? []) {
            const call = (calls[part.index] ??= { id: '', name: '', arguments: '' });
            call.id += part.id ?? '';
            call.name += part.function?.name ?? '';
            call.arguments += part.function?.arguments ?? '';
          }
        }
      } catch (err) {
        throw plainError(err);
      }
      for (const call of calls) if (call) yield { type: 'tool', call };
    },
  };
}
