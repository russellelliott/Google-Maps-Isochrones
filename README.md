# Google Maps Isochrone Generator

A React application that creates isochrone maps showing areas reachable within a specified travel time from any location.

## What is an Isochrone?

An isochrone map shows the area you can reach from a starting point within a given time limit. For example, a 30-minute driving isochrone shows everywhere you can drive to in 30 minutes or less, accounting for real traffic conditions.

## Features

- **Any Starting Location**: Enter any address or location
- **Multiple Travel Modes**: Driving (with traffic), Walking, Bicycling, Transit
- **Configurable Time Limits**: 1-120 minutes
- **Real-Time Traffic**: Uses current traffic data for driving directions
- **Smooth Boundaries**: Advanced algorithms create natural, rounded isochrone shapes

## How It Works

### Smart Point Sampling
The app generates thousands of sample points around your location using multiple strategies:
- **Multi-resolution grids** with adaptive density based on travel time
- **Radial sampling** in concentric circles for better coverage
- **Random jitter** to avoid grid artifacts and create smoother edges

### Efficient API Usage
To handle large numbers of points while respecting Google Maps API limits:
- **Intelligent chunking** splits requests into 25-point batches
- **Concurrent processing** handles multiple chunks simultaneously
- **Rate limiting** prevents API quota issues
- **Error resilience** continues even if some chunks fail

### Advanced Polygon Creation
- **Algorithm selection**: Uses convex hull for small areas, alpha shapes for larger ones
- **Edge smoothing**: Adds intermediate points along long edges for natural curves
- **Traffic integration**: Prioritizes real-time traffic data over static travel times

## Setup

1. Get a Google Maps API key with Distance Matrix and Maps JavaScript APIs enabled
2. Create a `.env` file with: `REACT_APP_GOOGLE_MAPS_API_KEY=your_api_key_here`
3. Install dependencies: `npm install`
4. Start the app: `npm start`

## Technical Details

The app processes 1000+ sample points for larger isochrones, automatically chunking API requests to stay within Google's limits while maintaining fast performance through concurrent processing. The result is professional-quality isochrone maps with smooth, realistic boundaries.

---

*Original concept from: https://gemini.google.com/app/0cf66e1651b28aaf*

