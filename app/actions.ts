import { DailyForecastResponse, HourlyForecastResponse } from '@/lib/types'

interface coordinates {
  latitude: string
  longitude: string
}

const API_KEY = process.env.OPEN_WEATHER_API_KEY
const API_ENDPOINT = process.env.OPEN_WEATHER_API_ENDPOINT

export async function getUVData({ latitude, longitude }: coordinates) {
  const data = await fetch(
    `${process.env.VERCEL_URL}/api/weather/uv_index?lat=${latitude}&lon=${longitude}`
  )

  if (!data.ok) throw new Error('Failed to fetch data')

  return data.json()
}

// prettier-ignore
export async function getDailyForecast({ latitude, longitude }: coordinates): Promise<DailyForecastResponse> {
  console.log('Called getDailyForecast')

  const data = await fetch(
    `https://api.openweathermap.org/data/2.5/forecast/daily?lat=${latitude}&lon=${longitude}&cnt=10&units=metric&appid=${API_KEY}`
  )

  if (!data.ok) throw new Error('Failed to fetch data')

  return data.json()
}

// prettier-ignore
export async function getHourlyData({ latitude, longitude }: coordinates): Promise<HourlyForecastResponse> {
  console.log('Called getHourlyData')
  console.log('API_ENDPOINT:', API_ENDPOINT)
  console.log('API_KEY:', API_KEY ? 'Set' : 'Not set')

  const url = `${API_ENDPOINT}/forecast?lat=${latitude}&lon=${longitude}&appid=${API_KEY}&units=metric`
  console.log('Fetching from URL:', url)

  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.log('Response not OK. Status:', response.status)
      console.log('Response text:', await response.text())
      throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return data
  } catch (error) {
    console.error('Fetch error:', error)
    throw error
  }
}

// prettier-ignore
export async function getAirPollutionData({ latitude, longitude }: coordinates) {
  const data = await fetch(
    `${process.env.VERCEL_URL}/api/weather/air_pollution?lat=${latitude}&lon=${longitude}`
  )

  if (!data.ok) throw new Error('Failed to fetch data')

  return data.json()
}
