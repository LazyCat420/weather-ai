import 'server-only'
import { z } from 'zod'
import { createAI, createStreamableUI, getMutableAIState } from 'ai/rsc'
import { getDailyForecast, getHourlyData } from '@/app/actions'
import { WeatherMap } from '@/components/llm-weather/weather-map'
import { getCoordinates } from '@/lib/utils'

// Components
import {
  BotCard,
  BotMessage,
  BotMessageText
} from '@/components/llm-weather/message'
import { spinner } from '@/components/llm-weather/spinner'
import Temperature from '@/components/llm-weather/weather-temperature'
import { DailyForecast } from '@/components/llm-weather/weather-daily-forecast'
import { HourlyForecast } from '@/components/llm-weather/weather-hourly-forecast'

const WeatherLayer = z.enum(['temperature', 'rain', 'wind', 'clouds', 'pressure'])

const SYSTEM_PROMPT = `

THE user current location is *"San Francisco"*

You are a weather chat bot and you can help users check weather conditions, step by step. You and the user can discuss weather forecasts for different locations, if the user doesn't select a city or region assume the user is asking about the weather in their current location (above).

If the user inquires to see a weather map or radar, call \`show_weather_map\` with their specified or assumed location and chosen weather layer based on the context of the conversation (e.g., temperature, rain, wind, clouds, pressure) to display the map.

If the user inquires specifically about the current weather or current temperature or what the temperature feels like, call \`show_weather_temperature\` with the specified or assumed location to display the current temperature and the 'feels like' temperature.

If users inquires in the daily forecast for the next few days, call \`show_daily_forecast\` with the specified or assumed location to display the daily weather forecast. This can help users plan their activities and prepare for the weather ahead.

If the user inquires about the weather later today or the hourly forecast, call \`show_hourly_forecast\` with the specified or assumed location to display the hourly weather forecast. This can help users plan their day and know what to expect hour by hour.

Besides that, you can also chat with users about weather advisories, suggest activities based on the weather, and provide detailed forecasts if needed.`

async function submitUserMessage(content: string) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()
  aiState.update([
    ...aiState.get(),
    {
      role: 'user',
      content
    }
  ])

  const reply = createStreamableUI(
    <BotMessage className="items-center">{spinner}</BotMessage>
  )

  const systemPrompt = {
    role: "system",
    content: SYSTEM_PROMPT
  };

  const messages = [systemPrompt, ...aiState.get()];

  try {
    const response = await fetch('http://10.0.0.29:11434/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
    let streamedContent = '';

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
              if (parsed.message) {
                streamedContent += parsed.message.content;
                
                if (/weather map|radar|map/i.test(streamedContent)) {
                  const location = streamedContent.match(/location:\s*([^,\n]+)/i)?.[1]?.trim() || 'San Francisco';
                  const layer = streamedContent.match(/layer:\s*(\w+)/i)?.[1]?.toLowerCase() as z.infer<typeof WeatherLayer> || 'temperature';
                  const { lat, lon } = await getCoordinates(location);
                  reply.update(
                    <BotCard>
                      <WeatherMap
                        latitude={lat}
                        longitude={lon}
                        layer={layer}
                        zoom={10}
                      />
                    </BotCard>
                  );
                } else if (/current weather|temperature|feels like/i.test(streamedContent)) {
                  const location = streamedContent.match(/location:\s*([^,\n]+)/i)?.[1]?.trim() || 'San Francisco';
                  const { lat, lon } = await getCoordinates(location);
                  const temperatureData = await getHourlyData({ latitude: lat, longitude: lon });
                  reply.update(
                    <BotCard>
                      <Temperature data={temperatureData} />
                    </BotCard>
                  );
                } else if (/daily forecast|next few days/i.test(streamedContent)) {
                  const location = streamedContent.match(/location:\s*([^,\n]+)/i)?.[1]?.trim() || 'San Francisco';
                  const { lat, lon } = await getCoordinates(location);
                  const forecastData = await getDailyForecast({ latitude: lat, longitude: lon });
                  reply.update(
                    <BotCard>
                      <DailyForecast data={forecastData} />
                    </BotCard>
                  );
                } else if (/hourly forecast|later today/i.test(streamedContent)) {
                  const location = streamedContent.match(/location:\s*([^,\n]+)/i)?.[1]?.trim() || 'San Francisco';
                  const { lat, lon } = await getCoordinates(location);
                  const hourlyData = await getHourlyData({ latitude: lat, longitude: lon });
                  reply.update(
                    <BotCard>
                      <HourlyForecast data={hourlyData} />
                    </BotCard>
                  );
                } else {
                  reply.update(<BotMessageText content={streamedContent} />);
                }
              }
            } catch (e) {
              console.error('Error parsing JSON:', e);
            }
          }
        }
      }
    }

    reply.done();
    aiState.done([...aiState.get(), { role: 'assistant', content: streamedContent }]);

    return {
      id: Date.now(),
      display: reply.value
    };
  } catch (error) {
    console.error('Error:', error);
    reply.done(<BotMessageText content="Sorry, I'm having trouble connecting. Please try again later." />);
    return {
      id: Date.now(),
      display: reply.value
    };
  }
}

const initialAIState: {
  role: 'user' | 'assistant' | 'system' | 'function'
  content: string
  id?: string
  name?: string
}[] = []

const initialUIState: {
  id: number
  display: React.ReactNode
}[] = []

export const AI = createAI({
  actions: {
    submitUserMessage
  },
  initialUIState,
  initialAIState
})
