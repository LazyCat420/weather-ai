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
You are a weather chat bot that helps users check weather conditions step by step. You can discuss weather forecasts for different locations.

When a user asks about the weather, temperature, or forecast for a specific location, always mention the location in your response.

If the user asks to see a weather map or radar, mention "show_weather_map" in your response.

If the user asks about the current weather, temperature, or what it feels like, mention "show_weather_temperature" in your response.

If the user asks about the daily forecast for the next few days, mention "show_daily_forecast" in your response.

If the user asks about the weather later today or the hourly forecast, mention "show_hourly_forecast" in your response.

You can also chat about weather advisories, suggest activities based on the weather, and provide detailed forecasts if needed.`

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
        try {
          const jsonChunk = JSON.parse(chunk);
          if (jsonChunk.message && jsonChunk.message.content) {
            streamedContent += jsonChunk.message.content;
            reply.update(<BotMessageText content={streamedContent} />);
          }
        } catch (e) {
          console.error('Error parsing JSON chunk:', e);
        }
      }
    }

    // Extract location from user's message or AI's response
    const locationMatch = content.match(/(?:in|at|for|of)\s+([^?.,]+)/i) || streamedContent.match(/(?:in|at|for|of)\s+([^?.,]+)/i);
    const userLocation = locationMatch ? locationMatch[1].trim() : null;

    if (userLocation) {
      const { lat, lon } = await getCoordinates(userLocation);

      let additionalContent = null;

      if (/weather|temperature|forecast|map|radar/i.test(content)) {
        if (/map|radar/i.test(content)) {
          const layer = 'temperature'; // Default to temperature layer
          additionalContent = (
            <BotCard>
              <WeatherMap
                latitude={lat}
                longitude={lon}
                layer={layer}
                zoom={10}
              />
            </BotCard>
          );
        } else if (/daily forecast|next few days/i.test(content)) {
          const forecastData = await getDailyForecast({ latitude: lat.toString(), longitude: lon.toString() });
          additionalContent = (
            <BotCard>
              <DailyForecast data={forecastData} />
            </BotCard>
          );
        } else if (/hourly forecast|later today/i.test(content)) {
          const hourlyData = await getHourlyData({ latitude: lat.toString(), longitude: lon.toString() });
          additionalContent = (
            <BotCard>
              <HourlyForecast data={hourlyData} />
            </BotCard>
          );
        } else {
          const temperatureData = await getHourlyData({ latitude: lat.toString(), longitude: lon.toString() });
          additionalContent = (
            <BotCard>
              <Temperature data={temperatureData} />
            </BotCard>
          );
        }
      }

      reply.update(
        <>
          <BotMessageText content={streamedContent} />
          {additionalContent}
        </>
      );
      reply.done();
      aiState.done([...aiState.get(), { role: 'assistant', content: streamedContent }]);

      return {
        id: Date.now(),
        display: reply.value
      };
    } else {
      reply.done(<BotMessageText content="I'm sorry, but I couldn't determine the location you're asking about. Could you please specify the city or location you want the weather information for?" />);
      return {
        id: Date.now(),
        display: reply.value
      };
    }
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
