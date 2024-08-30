import {
  TAnyToolDefinitionArray,
  TToolDefinitionMap
} from '@/lib/utils/tool-definition'
import { OpenAIStream } from 'ai'
import type OpenAI from 'openai'
import zodToJsonSchema from 'zod-to-json-schema'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { z } from 'zod'

const consumeStream = async (stream: ReadableStream) => {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

export function runOpenAICompletion<
  T extends Omit<
    Parameters<typeof OpenAI.prototype.chat.completions.create>[0],
    'functions'
  >,
  const TFunctions extends TAnyToolDefinitionArray
>(
  openai: OpenAI,
  params: T & {
    functions: TFunctions
  }
) {
  let text = ''
  let hasFunction = false

  type TToolMap = TToolDefinitionMap<TFunctions>
  let onTextContent: (text: string, isFinal: boolean) => void = () => {}

  const functionsMap: Record<string, TFunctions[number]> = {}
  for (const fn of params.functions) {
    functionsMap[fn.name] = fn
  }

  let onFunctionCall = {} as any

  const { functions, ...rest } = params

  ;(async () => {
    consumeStream(
      OpenAIStream(
        (await openai.chat.completions.create({
          ...rest,
          stream: true,
          functions: functions.map(fn => ({
            name: fn.name,
            description: fn.description,
            parameters: zodToJsonSchema(fn.parameters) as Record<
              string,
              unknown
            >
          }))
        })) as any,
        {
          async experimental_onFunctionCall(functionCallPayload) {
            hasFunction = true

            if (!onFunctionCall[functionCallPayload.name]) {
              return
            }

            // we need to convert arguments from z.input to z.output
            // this is necessary if someone uses a .default in their schema
            const zodSchema = functionsMap[functionCallPayload.name].parameters
            const parsedArgs = zodSchema.safeParse(
              functionCallPayload.arguments
            )

            if (!parsedArgs.success) {
              throw new Error(
                `Invalid function call in message. Expected a function call object`
              )
            }

            onFunctionCall[functionCallPayload.name]?.(parsedArgs.data)
          },
          onToken(token) {
            text += token
            if (text.startsWith('{')) return
            onTextContent(text, false)
          },
          onFinal() {
            if (hasFunction) return
            onTextContent(text, true)
          }
        }
      )
    )
  })()

  return {
    onTextContent: (
      callback: (text: string, isFinal: boolean) => void | Promise<void>
    ) => {
      onTextContent = callback
    },
    onFunctionCall: <TName extends TFunctions[number]['name']>(
      name: TName,
      callback: (
        args: z.output<
          TName extends keyof TToolMap
            ? TToolMap[TName] extends infer TToolDef
              ? TToolDef extends TAnyToolDefinitionArray[number]
                ? TToolDef['parameters']
                : never
              : never
            : never
        >
      ) => void | Promise<void>
    ) => {
      onFunctionCall[name] = callback
    }
  }
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(value)

export const runAsyncFnWithoutBlocking = (
  fn: (...args: any) => Promise<any>
) => {
  fn()
}

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

// Fake data
export function getStockPrice(name: string) {
  let total = 0
  for (let i = 0; i < name.length; i++) {
    total = (total + name.charCodeAt(i) * 9999121) % 9999
  }
  return total / 100
}

export async function getCoordinates(location: string): Promise<{ lat: string; lon: string }> {
  // TODO: Implement actual geocoding logic here
  // For now, we'll return dummy coordinates for San Francisco
  return { lat: '37.7749', lon: '-122.4194' };
}

export async function runOllamaCompletion(
  messages: Array<{ role: string; content: string }>,
  functions: Array<{ name: string; parameters: z.ZodType<any, any> }>
) {
  const response = await fetch('http://10.0.0.29:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.1:8b',
      messages: messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  return {
    async *streamCompletion() {
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.trim() !== '') {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                  yield parsed.message.content;
                }
              } catch (e) {
                console.error('Error parsing JSON:', e);
              }
            }
          }
        }
      }
    },
    parseForFunctionCalls(content: string) {
      for (const func of functions) {
        if (content.includes(func.name)) {
          const match = content.match(new RegExp(`${func.name}\\s*\\((.*?)\\)`, 's'));
          if (match) {
            try {
              const args = JSON.parse(match[1]);
              const parsed = func.parameters.safeParse(args);
              if (parsed.success) {
                return { name: func.name, arguments: parsed.data };
              }
            } catch (e) {
              console.error(`Error parsing arguments for ${func.name}:`, e);
            }
          }
        }
      }
      return null;
    }
  };
}
