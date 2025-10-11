import axios from 'axios';

/**
 * Tool definitions for function calling
 */
export interface Tool {
  name: string;
  description: string;
  parameters: any;
}

export interface ToolResult {
  toolName: string;
  result: any;
  error?: string;
}

/**
 * ToolService provides access to external APIs for real-time information
 */
export class ToolService {
  private static get googleMapsKey() {
    return process.env.GOOGLE_MAPS_API_KEY;
  }

  private static get weatherKey() {
    return process.env.WEATHER_API_KEY;
  }

  /**
   * Get available tools for function calling
   */
  static getAvailableTools(): Tool[] {
    return [
      {
        name: 'get_directions',
        description:
          'Get driving directions, distance, duration, and current traffic information between two locations. Use this when user asks about commute time, how to get somewhere, or traffic conditions.',
        parameters: {
          type: 'object',
          properties: {
            origin: {
              type: 'string',
              description: 'Starting location address or place name',
            },
            destination: {
              type: 'string',
              description: 'Destination address or place name',
            },
            departure_time: {
              type: 'string',
              description:
                'ISO datetime for when to depart (optional, defaults to now for traffic)',
            },
          },
          required: ['origin', 'destination'],
        },
      },
      {
        name: 'search_places',
        description:
          'Search for nearby places like restaurants, coffee shops, gas stations, etc. Use this when user asks about finding places near a location or event.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'Location address or place name to search near',
            },
            query: {
              type: 'string',
              description:
                'What to search for (e.g., "italian restaurants", "coffee shop", "gas station")',
            },
            radius: {
              type: 'number',
              description: 'Search radius in meters (default: 5000)',
            },
          },
          required: ['location', 'query'],
        },
      },
      {
        name: 'get_weather',
        description:
          'Get weather forecast for a specific location and date. Use this when user asks about weather conditions for upcoming events.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'Location address or city name',
            },
            date: {
              type: 'string',
              description: 'ISO date for weather forecast (optional, defaults to today)',
            },
          },
          required: ['location'],
        },
      },
      {
        name: 'get_current_time',
        description:
          'Get the current date and time. Use this to calculate time-based information.',
        parameters: {
          type: 'object',
          properties: {
            timezone: {
              type: 'string',
              description: 'Timezone (e.g., "America/Los_Angeles", optional)',
            },
          },
        },
      },
    ];
  }

  /**
   * Execute a tool by name with parameters
   */
  static async executeTool(toolName: string, parameters: any): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'get_directions':
          return {
            toolName,
            result: await this.getDirections(
              parameters.origin,
              parameters.destination,
              parameters.departure_time
            ),
          };

        case 'search_places':
          return {
            toolName,
            result: await this.searchPlaces(
              parameters.location,
              parameters.query,
              parameters.radius
            ),
          };

        case 'get_weather':
          return {
            toolName,
            result: await this.getWeather(parameters.location, parameters.date),
          };

        case 'get_current_time':
          return {
            toolName,
            result: this.getCurrentTime(parameters.timezone),
          };

        default:
          return {
            toolName,
            result: null,
            error: `Unknown tool: ${toolName}`,
          };
      }
    } catch (error: any) {
      console.error(`Tool execution error (${toolName}):`, error);
      return {
        toolName,
        result: null,
        error: error.message || 'Tool execution failed',
      };
    }
  }

  /**
   * Get directions and traffic information using Google Routes API (New)
   */
  static async getDirections(
    origin: string,
    destination: string,
    departureTime?: string
  ): Promise<any> {
    if (!this.googleMapsKey) {
      return {
        error: 'Google Maps API key not configured',
        message: 'Set GOOGLE_MAPS_API_KEY in .env to enable directions',
      };
    }

    try {
      // Routes API uses POST with JSON body
      const requestBody = {
        origin: {
          address: origin,
        },
        destination: {
          address: destination,
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false,
        routeModifiers: {
          avoidTolls: false,
          avoidHighways: false,
          avoidFerries: false,
        },
        languageCode: 'en-US',
        units: 'IMPERIAL',
      };

      // Add departure time if provided
      if (departureTime) {
        (requestBody as any).departureTime = new Date(departureTime).toISOString();
      }

      const response = await axios.post(
        `https://routes.googleapis.com/directions/v2:computeRoutes`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.googleMapsKey,
            'X-Goog-FieldMask':
              'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.localizedValues',
          },
        }
      );

      if (!response.data.routes || response.data.routes.length === 0) {
        return {
          error: 'No routes found',
          message: 'Could not find a route between the locations',
        };
      }

      const route = response.data.routes[0];
      const leg = route.legs?.[0];

      return {
        origin: origin,
        destination: destination,
        distance: leg?.localizedValues?.distance?.text || `${Math.round(route.distanceMeters / 1609.34)} mi`,
        duration: leg?.localizedValues?.duration?.text || `${Math.round(parseInt(route.duration.replace('s', '')) / 60)} min`,
        duration_in_traffic: leg?.localizedValues?.duration?.text || `${Math.round(parseInt(route.duration.replace('s', '')) / 60)} min`,
        steps: leg?.steps?.slice(0, 10).map((step: any) => ({
          instruction: step.navigationInstruction?.instructions || 'Continue',
          distance: step.localizedValues?.distance?.text || '',
          duration: '',
        })) || [],
      };
    } catch (error: any) {
      throw new Error(`Google Routes API error: ${error.message}`);
    }
  }

  /**
   * Search for nearby places using Google Places API (New)
   */
  static async searchPlaces(
    location: string,
    query: string,
    radius: number = 5000
  ): Promise<any> {
    if (!this.googleMapsKey) {
      return {
        error: 'Google Maps API key not configured',
        message: 'Set GOOGLE_MAPS_API_KEY in .env to enable place search',
      };
    }

    try {
      // Places API (New) uses POST with text search
      const requestBody = {
        textQuery: query,
        locationBias: {
          circle: {
            center: {
              // Try to geocode the location first
              address: location,
            },
            radius: radius,
          },
        },
        maxResultCount: 5,
        languageCode: 'en',
      };

      const response = await axios.post(
        'https://places.googleapis.com/v1/places:searchText',
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.googleMapsKey,
            'X-Goog-FieldMask':
              'places.displayName,places.formattedAddress,places.rating,places.currentOpeningHours,places.types',
          },
        }
      );

      if (!response.data.places) {
        return {
          location,
          query,
          results: [],
        };
      }

      return {
        location,
        query,
        results: response.data.places.map((place: any) => ({
          name: place.displayName?.text || 'Unknown',
          address: place.formattedAddress || 'No address',
          rating: place.rating,
          open_now: place.currentOpeningHours?.openNow,
          types: place.types || [],
        })),
      };
    } catch (error: any) {
      throw new Error(`Google Places API error: ${error.message}`);
    }
  }

  /**
   * Get weather forecast using OpenWeatherMap API
   */
  static async getWeather(location: string, date?: string): Promise<any> {
    if (!this.weatherKey) {
      return {
        error: 'Weather API key not configured',
        message: 'Set WEATHER_API_KEY in .env to enable weather forecast',
      };
    }

    try {
      // Geocode location to get coordinates
      const geocodeResponse = await axios.get(
        'http://api.openweathermap.org/geo/1.0/direct',
        {
          params: {
            q: location,
            limit: 1,
            appid: this.weatherKey,
          },
        }
      );

      if (!geocodeResponse.data || geocodeResponse.data.length === 0) {
        return {
          error: 'Location not found',
          message: 'Could not geocode location',
        };
      }

      const { lat, lon, name, country } = geocodeResponse.data[0];

      // Get forecast
      const forecastResponse = await axios.get(
        'https://api.openweathermap.org/data/2.5/forecast',
        {
          params: {
            lat,
            lon,
            appid: this.weatherKey,
            units: 'imperial', // Fahrenheit
          },
        }
      );

      const targetDate = date ? new Date(date) : new Date();
      const forecasts = forecastResponse.data.list;

      // Find forecast closest to target date
      const targetForecast = forecasts.find((f: any) => {
        const forecastDate = new Date(f.dt * 1000);
        return forecastDate.toDateString() === targetDate.toDateString();
      }) || forecasts[0];

      return {
        location: `${name}, ${country}`,
        date: new Date(targetForecast.dt * 1000).toISOString(),
        temperature: Math.round(targetForecast.main.temp),
        feels_like: Math.round(targetForecast.main.feels_like),
        description: targetForecast.weather[0].description,
        humidity: targetForecast.main.humidity,
        wind_speed: Math.round(targetForecast.wind.speed),
        precipitation_chance: Math.round((targetForecast.pop || 0) * 100),
      };
    } catch (error: any) {
      throw new Error(`Weather API error: ${error.message}`);
    }
  }

  /**
   * Get current time (no external API needed)
   */
  static getCurrentTime(timezone?: string): any {
    const now = new Date();

    const result: any = {
      iso: now.toISOString(),
      date: now.toDateString(),
      time: now.toTimeString(),
      timestamp: now.getTime(),
    };

    if (timezone) {
      try {
        result.local_time = now.toLocaleString('en-US', { timeZone: timezone });
        result.timezone = timezone;
      } catch (e) {
        result.error = 'Invalid timezone';
      }
    }

    return result;
  }
}
