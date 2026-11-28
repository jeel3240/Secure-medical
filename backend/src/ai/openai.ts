/**
 * Asking OpenAI - A11, A28, A29, docs/AI-AGENT.md sections 1 and 12.
 *
 * The one place a call reaches OpenAI: the understand step (`openAiUnderstand`,
 * strict JSON) and the speak step (`openAiSpeak`, streamed). And what the call
 * asks of her brain (`SeriModel`, brain.ts): two kinds of event - words as they
 * are written, and the action once it is decided - so the conversation
 * (conversation.ts) is tested with a fake in its place.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { SERI_MODEL, SPEAK_CACHE_KEY, UNDERSTAND_CACHE_KEY, UNDERSTAND_EFFORT, UNDERSTAND_MODEL } from './model';

/** Her action, whole: an id, which action, and its arguments as JSON - checked again by `toHandoff`. */
export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * What her brain gives for a reply: words as they are written, her action once
 * decided - or `quiet`, nothing to say on purpose (a voicemail's greeting, an
 * "okay" with no question open), so the call does not warn of an empty reply
 * (review R9, 2026-11-23).
 */
export type ModelEvent = { type: 'text'; text: string } | { type: 'tool'; call: ModelToolCall } | { type: 'quiet' };

/** Her brain, as the call asks it (brain.ts). */
export interface SeriModel {
  /** Her reply to the conversation so far, as it is written. Stops - it may throw - when `signal` aborts. */
  reply(messages: ChatCompletionMessageParam[], signal: AbortSignal): AsyncIterable<ModelEvent>;
  /**
   * The lead's words while they are still being said (A33): a head start the
   * reply may use if the words it is asked about turn out the same. Never
   * changes what the reply is.
   */
  prefetch?(messages: ChatCompletionMessageParam[], said: string): void;
}

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

/** The understand step's request (A28): the acts in a lead's words, as JSON. */
export interface UnderstandModel {
  /** OpenAI's answer, whole. Throws - `plainError` - when it fails, or when `signal` aborts. */
  understand(messages: ChatCompletionMessageParam[], format: object, signal: AbortSignal): Promise<string>;
}

/** Labels are a few words; this only stops a runaway answer. */
const MAX_UNDERSTAND_TOKENS = 200;

export function openAiUnderstand(apiKey: string): UnderstandModel {
  let client: OpenAI | null = null;
  return {
    async understand(messages, format, signal) {
      client ??= new OpenAI({ apiKey, timeout: 15_000, maxRetries: 0 });
      try {
        const reply = await client.chat.completions.create(
          {
            model: UNDERSTAND_MODEL,
            reasoning_effort: UNDERSTAND_EFFORT,
            messages,
            response_format: format as never,
            max_completion_tokens: MAX_UNDERSTAND_TOKENS,
            prompt_cache_key: UNDERSTAND_CACHE_KEY,
          },
          { signal }
        );
        return reply.choices[0]?.message?.content ?? '';
      } catch (err) {
        throw plainError(err);
      }
    },
  };
}

/** Replies are a sentence or two; this only stops a runaway one. */
const MAX_REPLY_TOKENS = 300;

/** The speak step's request (A29, A30): her words for a reply's moves, streamed - no tools, she decides nothing. */
export interface SpeakModel {
  /** Her words as they are written. Stops - it may throw - when `signal` aborts. */
  stream(messages: ChatCompletionMessageParam[], signal: AbortSignal): AsyncIterable<string>;
}

export function openAiSpeak(apiKey: string): SpeakModel {
  let client: OpenAI | null = null;
  return {
    async *stream(messages, signal) {
      client ??= new OpenAI({ apiKey, timeout: 15_000, maxRetries: 0 });
      try {
        const stream = await client.chat.completions.create(
          { model: SERI_MODEL, messages, stream: true, max_completion_tokens: MAX_REPLY_TOKENS, prompt_cache_key: SPEAK_CACHE_KEY },
          { signal }
        );
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) yield text;
        }
      } catch (err) {
        throw plainError(err);
      }
    },
  };
}
