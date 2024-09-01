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
You are a weather chat bot that helps users check weather conditions. You can discuss weather forecasts for different locations.

When a user asks about the weather, temperature, or forecast for a specific location, always use the get_weather_data tool to fetch accurate information.

After receiving the weather data, provide a natural language response that includes the information.

You can also chat about weather advisories, suggest activities based on the weather, and provide detailed forecasts if needed.

Always use the tool to get accurate data before responding to weather-related queries.`

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

  // Extract location from user's message
  const locationMatch = content.match(/(?:in|at|for|of)\s+([^?.,]+)/i);
  const userLocation = locationMatch ? locationMatch[1].trim() : null;

  if (userLocation) {
    const { lat, lon } = await getCoordinates(userLocation);

    let additionalContent = null;
    let weatherData = null;

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
        weatherData = await getDailyForecast({ latitude: lat.toString(), longitude: lon.toString() });
        additionalContent = (
          <BotCard>
            <DailyForecast data={weatherData} />
          </BotCard>
        );
      } else if (/hourly forecast|later today/i.test(content)) {
        weatherData = await getHourlyData({ latitude: lat.toString(), longitude: lon.toString() });
        additionalContent = (
          <BotCard>
            <HourlyForecast data={weatherData} />
          </BotCard>
        );
      } else {
        weatherData = await getHourlyData({ latitude: lat.toString(), longitude: lon.toString() });
        additionalContent = (
          <BotCard>
            <Temperature data={weatherData} />
          </BotCard>
        );
      }
    }

    // Display the weather widget first
    reply.update(
      <>
        {additionalContent}
        <BotMessage className="items-center">{spinner}</BotMessage>
      </>
    );

    // Now generate the LLM response
    const systemPrompt = {
      role: "system",
      content: SYSTEM_PROMPT
    };

    const messages = [systemPrompt, ...aiState.get()];

    const getWeatherData = {
      name: "get_weather_data",
      description: "Get current weather data for a location",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The location to get weather data for"
          }
        },
        required: ["location"]
      },
      function: async (args: { location: string }) => {
        const { lat, lon } = await getCoordinates(args.location);
        const weatherData = await getHourlyData({ latitude: lat.toString(), longitude: lon.toString() });
        return {
          location: args.location,
          temperature: weatherData.list[0].main.temp,
          conditions: weatherData.list[0].weather[0].description
        };
      }
    };

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
          tools: [getWeatherData],
          tool_choice: "auto",
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
              reply.update(
                <>
                  {additionalContent}
                  <BotMessageText content={streamedContent} />
                </>
              );
            } else if (jsonChunk.message && jsonChunk.message.tool_calls) {
              const toolCall = jsonChunk.message.tool_calls[0];
              if (toolCall.function.name === "get_weather_data") {
                const args = JSON.parse(toolCall.function.arguments);
                const weatherData = await getWeatherData.function(args);
                const weatherResponse = `Current weather in ${weatherData.location}: Temperature: ${weatherData.temperature}°F, Conditions: ${weatherData.conditions}`;
                streamedContent += weatherResponse;
                reply.update(
                  <>
                    {additionalContent}
                    <BotMessageText content={streamedContent} />
                  </>
                );
              }
            }
          } catch (e) {
            console.error('Error parsing JSON chunk:', e);
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
  } else {
    reply.done(<BotMessageText content="I'm sorry, but I couldn't determine the location you're asking about. Could you please specify the city or location you want the weather information for?" />);
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
