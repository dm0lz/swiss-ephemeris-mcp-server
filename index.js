#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'node:child_process';
import express from 'express';

class SwissEphemerisServer {
  constructor() {
    this.server = new Server(
      {
        name: 'swiss-ephemeris-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'calculate_planetary_positions',
            description: 'Calculate planetary positions, houses, chart points and asteroids for a given datetime and coordinates',
            inputSchema: {
              type: 'object',
              properties: {
                datetime: {
                  type: 'string',
                  description: 'ISO8601 datetime, e.g., 1985-04-12T23:20:50Z',
                },
                latitude: {
                  type: 'number',
                  description: 'Latitude in decimal degrees',
                },
                longitude: {
                  type: 'number',
                  description: 'Longitude in decimal degrees, positive east',
                },
              },
              required: ['datetime', 'latitude', 'longitude'],
            },
          },
          {
            name: 'calculate_transits',
            description: 'Calculate birth chart positions and current transits for comparison. Returns both natal chart and current planetary positions.',
            inputSchema: {
              type: 'object',
              properties: {
                birth_datetime: {
                  type: 'string',
                  description: 'Birth datetime in ISO8601 format, e.g., 1985-04-12T23:20:50Z',
                },
                latitude: {
                  type: 'number',
                  description: 'Birth latitude in decimal degrees',
                },
                longitude: {
                  type: 'number',
                  description: 'Birth longitude in decimal degrees, positive east',
                },
              },
              required: ['birth_datetime', 'latitude', 'longitude'],
            },
          },
          {
            name: 'calculate_solar_revolution',
            description: 'Calculate solar return chart for a specific year. The solar return occurs when the Sun returns to the exact same position as at birth.',
            inputSchema: {
              type: 'object',
              properties: {
                birth_datetime: {
                  type: 'string',
                  description: 'Birth datetime in ISO8601 format, e.g., 1985-04-12T23:20:50Z',
                },
                birth_latitude: {
                  type: 'number',
                  description: 'Birth latitude in decimal degrees',
                },
                birth_longitude: {
                  type: 'number',
                  description: 'Birth longitude in decimal degrees, positive east',
                },
                return_year: {
                  type: 'number',
                  description: 'Year for the solar return calculation, e.g., 2024',
                },
                return_latitude: {
                  type: 'number',
                  description: 'Latitude for solar return location (optional, defaults to birth location)',
                },
                return_longitude: {
                  type: 'number',
                  description: 'Longitude for solar return location (optional, defaults to birth location)',
                },
              },
              required: ['birth_datetime', 'birth_latitude', 'birth_longitude', 'return_year'],
            },
          },
          {
            name: 'calculate_synastry',
            description: 'Calculate synastry chart between two people for relationship compatibility analysis. Compares planetary positions and calculates aspects between the charts.',
            inputSchema: {
              type: 'object',
              properties: {
                person1_datetime: {
                  type: 'string',
                  description: 'Person 1 birth datetime in ISO8601 format, e.g., 1985-04-12T23:20:50Z',
                },
                person1_latitude: {
                  type: 'number',
                  description: 'Person 1 birth latitude in decimal degrees',
                },
                person1_longitude: {
                  type: 'number',
                  description: 'Person 1 birth longitude in decimal degrees, positive east',
                },
                person2_datetime: {
                  type: 'string',
                  description: 'Person 2 birth datetime in ISO8601 format, e.g., 1990-08-25T14:30:00Z',
                },
                person2_latitude: {
                  type: 'number',
                  description: 'Person 2 birth latitude in decimal degrees',
                },
                person2_longitude: {
                  type: 'number',
                  description: 'Person 2 birth longitude in decimal degrees, positive east',
                },
              },
              required: ['person1_datetime', 'person1_latitude', 'person1_longitude', 'person2_datetime', 'person2_latitude', 'person2_longitude'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.handleToolCall(name, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error.message}`
        );
      }
    });
  }

  formatDateToSwiss(date) {
    // Format date as DD.MM.YYYY using UTC components
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }

  formatTimeToSwiss(date) {
    // Format time as HH:MM:SS using UTC components
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  parsePlanetLine(line) {
    // Parse planet position line from swetest output
    // Format: "Sun            ,22 le 53'51.2332" or "Moon           , 2 cp 21' 3.2731"
    const parts = line.trim().split(',');
    if (parts.length < 2) return null;

    const name = parts[0].trim();
    const positionStr = parts[1].trim();
    
    // Parse position like "22 le 53'51.2332" or "2 cp 21' 3.2731" (note space after apostrophe)
    const posMatch = positionStr.match(/^(\d+)\s+([a-z]{2})\s+(\d+)'\s*([\d.]+)$/i);
    if (!posMatch) return null;

    const degrees = parseInt(posMatch[1]);
    const signAbbr = posMatch[2].toLowerCase();
    const minutes = parseInt(posMatch[3]);
    const seconds = parseFloat(posMatch[4]);

    // Map sign abbreviations to full names and calculate longitude
    const signMap = {
      'ar': { name: 'Aries', offset: 0 },
      'ta': { name: 'Taurus', offset: 30 },
      'ge': { name: 'Gemini', offset: 60 },
      'cn': { name: 'Cancer', offset: 90 },
      'le': { name: 'Leo', offset: 120 },
      'vi': { name: 'Virgo', offset: 150 },
      'li': { name: 'Libra', offset: 180 },
      'sc': { name: 'Scorpio', offset: 210 },
      'sa': { name: 'Sagittarius', offset: 240 },
      'cp': { name: 'Capricorn', offset: 270 },
      'aq': { name: 'Aquarius', offset: 300 },
      'pi': { name: 'Pisces', offset: 330 }
    };

    const signInfo = signMap[signAbbr];
    if (!signInfo) return null;

    // Calculate total longitude in degrees
    const longitude = signInfo.offset + degrees + (minutes / 60) + (seconds / 3600);

    return {
      name,
      longitude,
      sign: signInfo.name,
      degree: Math.round((degrees + (minutes / 60) + (seconds / 3600)) * 100) / 100
    };
  }

  parseHouseLine(line) {
    // Parse house cusp line from swetest output
    // Format: "house  1       ,13 cn 39'52.5152"
    const parts = line.trim().split(',');
    if (parts.length < 2) return null;

    const houseMatch = parts[0].trim().match(/^house\s+(\d+)/);
    if (!houseMatch) return null;

    const house = parseInt(houseMatch[1]);
    const positionStr = parts[1].trim();
    
    // Parse position like "13 cn 39'52.5152" (allow optional spaces after apostrophe)
    const posMatch = positionStr.match(/^(\d+)\s+([a-z]{2})\s+(\d+)'\s*([\d.]+)$/i);
    if (!posMatch) return null;

    const degrees = parseInt(posMatch[1]);
    const signAbbr = posMatch[2].toLowerCase();
    const minutes = parseInt(posMatch[3]);
    const seconds = parseFloat(posMatch[4]);

    // Map sign abbreviations to full names and calculate longitude
    const signMap = {
      'ar': { name: 'Aries', offset: 0 },
      'ta': { name: 'Taurus', offset: 30 },
      'ge': { name: 'Gemini', offset: 60 },
      'cn': { name: 'Cancer', offset: 90 },
      'le': { name: 'Leo', offset: 120 },
      'vi': { name: 'Virgo', offset: 150 },
      'li': { name: 'Libra', offset: 180 },
      'sc': { name: 'Scorpio', offset: 210 },
      'sa': { name: 'Sagittarius', offset: 240 },
      'cp': { name: 'Capricorn', offset: 270 },
      'aq': { name: 'Aquarius', offset: 300 },
      'pi': { name: 'Pisces', offset: 330 }
    };

    const signInfo = signMap[signAbbr];
    if (!signInfo) return null;

    // Calculate total longitude in degrees
    const longitude = signInfo.offset + degrees + (minutes / 60) + (seconds / 3600);

    return {
      house,
      longitude,
      sign: signInfo.name,
      degree: Math.round((degrees + (minutes / 60) + (seconds / 3600)) * 100) / 100
    };
  }

  parseChartPointLine(line) {
    // Parse chart point line from swetest output
    // Format: "Ascendant      ,13 cn 39'52.5152"
    const parts = line.trim().split(',');
    if (parts.length < 2) return null;

    const name = parts[0].trim();
    const positionStr = parts[1].trim();
    
    // Parse position like "13 cn 39'52.5152" (allow optional spaces after apostrophe)
    const posMatch = positionStr.match(/^(\d+)\s+([a-z]{2})\s+(\d+)'\s*([\d.]+)$/i);
    if (!posMatch) return null;

    const degrees = parseInt(posMatch[1]);
    const signAbbr = posMatch[2].toLowerCase();
    const minutes = parseInt(posMatch[3]);
    const seconds = parseFloat(posMatch[4]);

    // Map sign abbreviations to full names and calculate longitude
    const signMap = {
      'ar': { name: 'Aries', offset: 0 },
      'ta': { name: 'Taurus', offset: 30 },
      'ge': { name: 'Gemini', offset: 60 },
      'cn': { name: 'Cancer', offset: 90 },
      'le': { name: 'Leo', offset: 120 },
      'vi': { name: 'Virgo', offset: 150 },
      'li': { name: 'Libra', offset: 180 },
      'sc': { name: 'Scorpio', offset: 210 },
      'sa': { name: 'Sagittarius', offset: 240 },
      'cp': { name: 'Capricorn', offset: 270 },
      'aq': { name: 'Aquarius', offset: 300 },
      'pi': { name: 'Pisces', offset: 330 }
    };

    const signInfo = signMap[signAbbr];
    if (!signInfo) return null;

    // Calculate total longitude in degrees
    const longitude = signInfo.offset + degrees + (minutes / 60) + (seconds / 3600);

    return {
      name,
      longitude,
      sign: signInfo.name,
      degree: Math.round((degrees + (minutes / 60) + (seconds / 3600)) * 100) / 100
    };
  }

  calculateEphemeris(datetime, latitude, longitude) {
    try {
      const date = new Date(datetime);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid datetime format. Use ISO8601 format like 1985-04-12T23:20:50Z');
      }

      const swissDate = this.formatDateToSwiss(date);
      const swissTime = this.formatTimeToSwiss(date);
      const ephePath = process.env.SE_EPHE_PATH || '/app/vendor/swisseph';

      // Execute swetest for planets, including asteroids and additional points
      // 0123456789 = Sun through Pluto, t = true Node, A = mean Apogee (Lilith), D = Chiron, F = Ceres, G = Pallas, H = Juno, I = Vesta
      const planetCmd = `SE_EPHE_PATH=${ephePath} swetest -b${swissDate} -ut${swissTime} -p0123456789tADFGHI -fPZ -g, -head`;
      let planetOutput;
      try {
        planetOutput = execSync(planetCmd, { encoding: 'utf8' });
      } catch (error) {
        throw new Error(`Failed to execute swetest for planets: ${error.message}`);
      }

      // Execute swetest for houses (Placidus system)
      const houseCmd = `SE_EPHE_PATH=${ephePath} swetest -b${swissDate} -ut${swissTime} -house${longitude},${latitude},P -fPZ -g, -head`;
      let houseOutput;
      try {
        houseOutput = execSync(houseCmd, { encoding: 'utf8' });
      } catch (error) {
        throw new Error(`Failed to execute swetest for houses: ${error.message}`);
      }

      // Parse planets
      const planets = {};
      const planetLines = planetOutput.split('\n').filter(line => line.trim() && !line.includes('error:') && !line.includes('warning:'));
      
      planetLines.forEach(line => {
        const planet = this.parsePlanetLine(line);
        if (planet) {
          // Map swetest planet codes to readable names
          const planetNames = {
            'Sun': 'Sun',
            'Moon': 'Moon', 
            'Mercury': 'Mercury',
            'Venus': 'Venus',
            'Mars': 'Mars',
            'Jupiter': 'Jupiter',
            'Saturn': 'Saturn',
            'Uranus': 'Uranus',
            'Neptune': 'Neptune',
            'Pluto': 'Pluto',
            'mean Node': 'North Node',
            'true Node': 'North Node',
            'Chiron': 'Chiron',
            'mean Apogee': 'Lilith',
            'Ceres': 'Ceres',
            'Pallas': 'Pallas',
            'Juno': 'Juno',
            'Vesta': 'Vesta'
          };
          
          const name = planetNames[planet.name] || planet.name;
          planets[name] = {
            longitude: planet.longitude,
            sign: planet.sign,
            degree: planet.degree
          };
        }
      });

      // Parse houses and chart points from house output
      const houses = {};
      const chartPoints = {};
      const houseLines = houseOutput.split('\n').filter(line => line.trim() && !line.includes('error:') && !line.includes('warning:'));
      
      houseLines.forEach(line => {
        // Try parsing as house
        if (line.includes('house ')) {
          const house = this.parseHouseLine(line);
          if (house && house.house >= 1 && house.house <= 12) {
            houses[house.house] = {
              longitude: house.longitude,
              sign: house.sign,
              degree: house.degree
            };
          }
        }
        // Try parsing as chart point
        else if (line.includes('Ascendant') || line.includes('MC') || line.includes('ARMC') || line.includes('Vertex')) {
          const chartPoint = this.parseChartPointLine(line);
          if (chartPoint) {
            const pointNames = {
              'Ascendant': 'Ascendant',
              'MC': 'Midheaven',
              'ARMC': 'ARMC',
              'Vertex': 'Vertex'
            };
            
            const name = pointNames[chartPoint.name] || chartPoint.name;
            chartPoints[name] = {
              longitude: chartPoint.longitude,
              sign: chartPoint.sign,
              degree: chartPoint.degree
            };
          }
        }
      });

      // Calculate additional points
      const additionalPoints = {};

      // Add South Node (opposite of North Node)
      if (planets['North Node']) {
        const northNodeLon = planets['North Node'].longitude;
        const southNodeLon = (northNodeLon + 180) % 360;
        const signIndex = Math.floor(southNodeLon / 30);
        const degree = southNodeLon % 30;
        const signs = [
          'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
          'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
        ];
        
        additionalPoints['South Node'] = {
          longitude: southNodeLon,
          sign: signs[signIndex],
          degree: Math.round(degree * 100) / 100
        };
      }

      // Calculate Part of Fortune (ASC + Moon - Sun)
      if (chartPoints.Ascendant && planets.Sun && planets.Moon) {
        const ascLon = chartPoints.Ascendant.longitude;
        const sunLon = planets.Sun.longitude;
        const moonLon = planets.Moon.longitude;
        let fortuneLon = (ascLon + moonLon - sunLon) % 360;
        if (fortuneLon < 0) fortuneLon += 360;
        
        const signIndex = Math.floor(fortuneLon / 30);
        const degree = fortuneLon % 30;
        const signs = [
          'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
          'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
        ];
        
        additionalPoints['Part of Fortune'] = {
          longitude: fortuneLon,
          sign: signs[signIndex],
          degree: Math.round(degree * 100) / 100
        };
      }

      // Add IC and Descendant based on Ascendant and Midheaven
      if (chartPoints.Ascendant) {
        const ascLon = chartPoints.Ascendant.longitude;
        const descLon = (ascLon + 180) % 360;
        const signIndex = Math.floor(descLon / 30);
        const degree = descLon % 30;
        const signs = [
          'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
          'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
        ];
        
        chartPoints.Descendant = {
          longitude: descLon,
          sign: signs[signIndex],
          degree: Math.round(degree * 100) / 100
        };
      }

      if (chartPoints.Midheaven) {
        const mcLon = chartPoints.Midheaven.longitude;
        const icLon = (mcLon + 180) % 360;
        const signIndex = Math.floor(icLon / 30);
        const degree = icLon % 30;
        const signs = [
          'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
          'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
        ];
        
        chartPoints.IC = {
          longitude: icLon,
          sign: signs[signIndex],
          degree: Math.round(degree * 100) / 100
        };
      }

      return {
        planets,
        houses,
        chart_points: chartPoints,
        additional_points: additionalPoints,
        datetime: datetime,
        coordinates: {
          latitude,
          longitude
        }
      };

    } catch (error) {
      throw new Error(`Swiss Ephemeris calculation failed: ${error.message}`);
    }
  }

  calculateSynastryAspects(person1Planets, person2Planets) {
    const aspects = [];
    const aspectOrbs = {
      'conjunction': 8,
      'opposition': 8,
      'trine': 8,
      'square': 8,
      'sextile': 6,
      'quincunx': 3,
      'semisextile': 3
    };

    const aspectAngles = {
      'conjunction': 0,
      'semisextile': 30,
      'sextile': 60,
      'square': 90,
      'trine': 120,
      'quincunx': 150,
      'opposition': 180
    };

    // Main planets for synastry analysis
    const mainPlanets = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

    for (const planet1 of mainPlanets) {
      if (!person1Planets[planet1]) continue;
      
      for (const planet2 of mainPlanets) {
        if (!person2Planets[planet2]) continue;

        const lon1 = person1Planets[planet1].longitude;
        const lon2 = person2Planets[planet2].longitude;
        
        // Calculate the angular distance
        let distance = Math.abs(lon1 - lon2);
        if (distance > 180) {
          distance = 360 - distance;
        }

        // Check for each aspect type
        for (const [aspectName, aspectAngle] of Object.entries(aspectAngles)) {
          const orb = aspectOrbs[aspectName];
          const angleDiff = Math.abs(distance - aspectAngle);
          
          if (angleDiff <= orb) {
            aspects.push({
              person1_planet: planet1,
              person2_planet: planet2,
              aspect: aspectName,
              orb: angleDiff.toFixed(2),
              exact_angle: distance.toFixed(2),
              person1_position: {
                longitude: lon1,
                sign: person1Planets[planet1].sign,
                degree: person1Planets[planet1].degree
              },
              person2_position: {
                longitude: lon2,
                sign: person2Planets[planet2].sign,
                degree: person2Planets[planet2].degree
              }
            });
          }
        }
      }
    }

    return aspects.sort((a, b) => parseFloat(a.orb) - parseFloat(b.orb));
  }

  async handleToolCall(name, args) {
    switch (name) {
      case 'calculate_planetary_positions':
        const { datetime, latitude, longitude } = args;
        
        if (!datetime || typeof datetime !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'datetime parameter is required and must be a string'
          );
        }
        
        if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'latitude must be a number between -90 and 90'
          );
        }
        
        if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'longitude must be a number between -180 and 180'
          );
        }

        return this.calculateEphemeris(datetime, latitude, longitude);

      case 'calculate_transits':
        const { birth_datetime, latitude: birth_latitude, longitude: birth_longitude } = args;
        
        if (!birth_datetime || typeof birth_datetime !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'birth_datetime parameter is required and must be a string'
          );
        }
        
        if (typeof birth_latitude !== 'number' || birth_latitude < -90 || birth_latitude > 90) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'birth_latitude must be a number between -90 and 90'
          );
        }
        
        if (typeof birth_longitude !== 'number' || birth_longitude < -180 || birth_longitude > 180) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'birth_longitude must be a number between -180 and 180'
          );
        }

        // Calculate birth chart
        const natalChart = this.calculateEphemeris(birth_datetime, birth_latitude, birth_longitude);
 
         // Calculate current transits
         const currentDate = new Date();
         const currentISOString = currentDate.toISOString();
         const currentEphemeris = this.calculateEphemeris(currentISOString, birth_latitude, birth_longitude);
 
         return {
           natal_chart: natalChart,
           current_transits: currentEphemeris,
           calculation_time: currentISOString
         };

      case 'calculate_solar_revolution':
        const { birth_datetime: sr_birth_datetime, birth_latitude: sr_birth_latitude, birth_longitude: sr_birth_longitude, return_year, return_latitude, return_longitude } = args;

        if (!sr_birth_datetime || typeof sr_birth_datetime !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'birth_datetime parameter is required and must be a string'
          );
        }

        if (typeof sr_birth_latitude !== 'number' || sr_birth_latitude < -90 || sr_birth_latitude > 90) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'birth_latitude must be a number between -90 and 90'
          );
        }

        if (typeof sr_birth_longitude !== 'number' || sr_birth_longitude < -180 || sr_birth_longitude > 180) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'birth_longitude must be a number between -180 and 180'
          );
        }

        if (typeof return_year !== 'number' || return_year < 1900 || return_year > 2100) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'return_year must be a number between 1900 and 2100'
          );
        }

        // Calculate birth chart to get natal Sun position
        const srNatalChart = this.calculateEphemeris(sr_birth_datetime, sr_birth_latitude, sr_birth_longitude);
        const natalSunLongitude = srNatalChart.planets.Sun.longitude;

        // Calculate solar return chart for the given year
        // Use the birthday in the return year as a starting point
        const birthDate = new Date(sr_birth_datetime);
        const returnDate = new Date(return_year, birthDate.getMonth(), birthDate.getDate(), birthDate.getHours(), birthDate.getMinutes(), birthDate.getSeconds());
        
        // Use return location if provided, otherwise use birth location
        const returnLat = return_latitude !== undefined ? return_latitude : sr_birth_latitude;
        const returnLon = return_longitude !== undefined ? return_longitude : sr_birth_longitude;
        
        // Calculate the solar return chart at the approximate return date
        const solarReturnChart = this.calculateEphemeris(returnDate.toISOString(), returnLat, returnLon);

        return {
          natal_chart: srNatalChart,
          solar_return_chart: {
            planets: solarReturnChart.planets,
            houses: solarReturnChart.houses,
            chart_points: solarReturnChart.chart_points,
            additional_points: solarReturnChart.additional_points,
            datetime: returnDate.toISOString(),
            coordinates: {
              latitude: returnLat,
              longitude: returnLon
            }
          },
          natal_sun_longitude: natalSunLongitude,
          return_sun_longitude: solarReturnChart.planets.Sun.longitude,
          calculation_time: new Date().toISOString()
        };

      case 'calculate_synastry':
        const { person1_datetime, person1_latitude, person1_longitude, person2_datetime, person2_latitude, person2_longitude } = args;

        if (!person1_datetime || typeof person1_datetime !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'person1_datetime parameter is required and must be a string'
          );
        }

        if (typeof person1_latitude !== 'number' || person1_latitude < -90 || person1_latitude > 90) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'person1_latitude must be a number between -90 and 90'
          );
        }

        if (typeof person1_longitude !== 'number' || person1_longitude < -180 || person1_longitude > 180) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'person1_longitude must be a number between -180 and 180'
          );
        }

        if (!person2_datetime || typeof person2_datetime !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'person2_datetime parameter is required and must be a string'
          );
        }

        if (typeof person2_latitude !== 'number' || person2_latitude < -90 || person2_latitude > 90) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'person2_latitude must be a number between -90 and 90'
          );
        }

        if (typeof person2_longitude !== 'number' || person2_longitude < -180 || person2_longitude > 180) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'person2_longitude must be a number between -180 and 180'
          );
        }

        // Calculate person 1's natal chart
        const person1NatalChart = this.calculateEphemeris(person1_datetime, person1_latitude, person1_longitude);

        // Calculate person 2's natal chart
        const person2NatalChart = this.calculateEphemeris(person2_datetime, person2_latitude, person2_longitude);

        // Calculate aspects between the two charts
        const aspects = this.calculateSynastryAspects(person1NatalChart.planets, person2NatalChart.planets);

        return {
          person1_chart: person1NatalChart,
          person2_chart: person2NatalChart,
          synastry_aspects: aspects,
          calculation_time: new Date().toISOString()
        };

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  }

  async run() {
    // Check if we should run as HTTP server (for ngrok) or stdio
    const useHttp = process.env.MCP_HTTP_MODE === 'true';
    
    if (useHttp) {
      // HTTP mode for ngrok
      const port = process.env.PORT || 8000;

      console.log('Starting HTTP server for ngrok...');
      console.log(`Port: ${port}`);

      const app = express();
      app.use(express.json());

      // Map to store transports by session ID
      const transports = {};

      // SSE endpoint for Claude MCP Connector
      app.all('/mcp', async (req, res) => {
        try {
          console.log(`Received ${req.method} MCP request from Claude via ngrok`);
          
          // Check for existing session ID
          const sessionId = req.headers['mcp-session-id'];
          let transport;

          if (sessionId && transports[sessionId]) {
            // Reuse existing transport
            transport = transports[sessionId];
          } else if (!sessionId && this.isInitializeRequest(req.body)) {
            // New initialization request
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => Math.random().toString(36).substring(2, 15),
            });

            // Connect to the MCP server
            await this.server.connect(transport);
            
            // Handle the request first, then store the transport
            await transport.handleRequest(req, res, req.body);
            
            // Store the transport by session ID after handling the request
            if (transport.sessionId) {
              transports[transport.sessionId] = transport;
              console.log(`✅ New session created and stored: ${transport.sessionId}`);
            }
            
            return; // Exit early since we already handled the request
          } else {
            // Invalid request
            return res.status(400).json({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Bad Request: No valid session ID provided',
              },
              id: null,
            });
          }

          // Handle the request using the transport (for existing sessions)
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          console.error('Error handling MCP request:', error);
          if (!res.headersSent) {
            res.status(500).json({ 
              error: 'Internal server error', 
              details: error.message 
            });
          }
        }
      });

      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({ 
          status: 'ok', 
          server: 'swiss-ephemeris-mcp-server',
          version: '1.0.0',
          transport: 'StreamableHTTP',
          protocol: 'http',
          port: port,
          note: 'Use ngrok for HTTPS tunneling',
          endpoint: '/mcp - StreamableHTTP transport for Claude MCP Connector'
        });
      });

      // Root endpoint with info
      app.get('/', (req, res) => {
        res.json({
          name: 'Swiss Ephemeris MCP Server',
          version: '1.0.0',
          description: 'MCP server for Swiss Ephemeris calculations with HTTP transport for ngrok tunneling',
          protocol: 'http',
          port: port,
          endpoints: {
            mcp: `/mcp - StreamableHTTP transport for Claude MCP Connector`,
            health: `/health - Health check`
          },
          usage: 'Use ngrok to create HTTPS tunnel, then connect Claude to the ngrok URL + /mcp',
          note: 'Start with: ngrok http ' + port
        });
      });

      app.listen(port, () => {
        console.log(`\n✅ HTTP server listening on port ${port}`);
        console.log(`🚇 Ready for ngrok tunneling`);
        console.log(`💡 Start ngrok with: ngrok http ${port}`);
        console.log(`MCP endpoint: http://localhost:${port}/mcp`);
        console.log(`Health check: http://localhost:${port}/health`);
        console.log('\nReady for Claude MCP Connector integration via ngrok\n');
      });
    } else {
      // Stdio mode (default) - for Claude Desktop
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Swiss Ephemeris MCP server running on stdio');
    }
  }

  // Helper method to check if request is an initialize request
  isInitializeRequest(body) {
    if (Array.isArray(body)) {
      return body.some(request => request.method === 'initialize');
    }
    return body && body.method === 'initialize';
  }
}

const server = new SwissEphemerisServer();
server.run().catch(console.error); 