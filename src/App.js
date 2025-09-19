import React, { useState, useEffect, useCallback } from "react";
import { GoogleMap, LoadScript, Polygon, Marker } from "@react-google-maps/api";

const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

const mapContainerStyle = {
  width: "100%",
  height: "600px",
};

const defaultCenter = { lat: 37.7749, lng: -122.4194 }; // Default to San Francisco

function App() {
  const [map, setMap] = useState(null);
  const [originLocation, setOriginLocation] = useState(null);
  const [originMarker, setOriginMarker] = useState(null);
  const [isochronePolygon, setIsochronePolygon] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [address, setAddress] = useState('');
  const [maxTime, setMaxTime] = useState(30);
  const [travelMode, setTravelMode] = useState('DRIVING');
  const [isLoaded, setIsLoaded] = useState(false);

  // Function to find the isochrone using grid-based approach
  const findIsochrone = useCallback(async () => {
    if (!map || !address) {
      setError('Please enter a valid address.');
      return;
    }
    
    setLoading(true);
    setError(null);
    setOriginLocation(null);
    
    // Clear existing markers and polygons
    if (originMarker) {
      originMarker.setMap(null);
      setOriginMarker(null);
    }
    if (isochronePolygon) {
      isochronePolygon.setMap(null);
      setIsochronePolygon(null);
    }

    const googleMaps = window.google.maps;
    const geocoder = new googleMaps.Geocoder();
    const distanceMatrixService = new googleMaps.DistanceMatrixService();

    try {
      console.log(`Starting isochrone calculation for: ${address}, ${maxTime} minutes, ${travelMode}`);
      
      // 1. Geocode the user-provided address to get coordinates
      const geocodeResponse = await new Promise((resolve, reject) => {
        geocoder.geocode({ address: address }, (results, status) => {
          if (status === 'OK' && results && results.length > 0) {
            resolve(results);
          } else {
            reject(new Error('Address not found. Please try again.'));
          }
        });
      });

      const origin = geocodeResponse[0].geometry.location;
      setOriginLocation(origin);

      // Create a marker for the origin
      const newOriginMarker = new googleMaps.Marker({
        position: origin,
        map: map,
        title: "Your Location",
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#4285F4",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 2
        }
      });
      setOriginMarker(newOriginMarker);
      map.setCenter(origin);

      // 2. Generate a multi-resolution grid of points around the origin
      const destinations = [];
      const searchRadiusKm = maxTime / 60 * 50; // Rough estimate based on max speed of 50 km/h
      
      // Use adaptive grid density - more points for larger search areas
      const baseGridDensity = 8;
      const adaptiveGridDensity = Math.min(baseGridDensity + Math.floor(searchRadiusKm / 10), 20);
      
      console.log(`Using adaptive grid density: ${adaptiveGridDensity} (search radius: ${searchRadiusKm.toFixed(1)}km)`);
      
      const centerLat = origin.lat();
      const centerLng = origin.lng();
      
      // Calculate lat/lng ranges for the grid
      const latRange = googleMaps.geometry.spherical.computeOffset(origin, searchRadiusKm * 1000, 0).lat() - centerLat;
      const lngRange = googleMaps.geometry.spherical.computeOffset(origin, searchRadiusKm * 1000, 90).lng() - centerLng;

      // Create multiple resolution levels for better edge definition
      const resolutionLevels = [
        { density: adaptiveGridDensity, weight: 1.0 },     // Main grid
        { density: Math.floor(adaptiveGridDensity * 1.5), weight: 0.7 }, // Finer grid
        { density: Math.floor(adaptiveGridDensity * 0.7), weight: 1.2 }  // Coarser grid with wider coverage
      ];

      resolutionLevels.forEach((level, levelIndex) => {
        const gridDensity = level.density;
        const searchMultiplier = level.weight;
        
        for (let i = -gridDensity; i <= gridDensity; i++) {
          for (let j = -gridDensity; j <= gridDensity; j++) {
            const lat = centerLat + (latRange * searchMultiplier / gridDensity) * i;
            const lng = centerLng + (lngRange * searchMultiplier / gridDensity) * j;
            
            // Add some random jitter to avoid perfectly aligned grid artifacts
            const jitterLat = lat + (Math.random() - 0.5) * (latRange / gridDensity) * 0.1;
            const jitterLng = lng + (Math.random() - 0.5) * (lngRange / gridDensity) * 0.1;
            
            destinations.push(new googleMaps.LatLng(jitterLat, jitterLng));
          }
        }
      });

      // Add radial points for better circular coverage
      const radialRings = 6;
      const pointsPerRing = 16;
      
      for (let ring = 1; ring <= radialRings; ring++) {
        const ringRadius = (searchRadiusKm * 1000 * ring) / radialRings;
        for (let i = 0; i < pointsPerRing; i++) {
          const angle = (i / pointsPerRing) * 2 * Math.PI;
          const point = googleMaps.geometry.spherical.computeOffset(origin, ringRadius, angle * 180 / Math.PI);
          destinations.push(point);
        }
      }

      console.log(`Generated ${destinations.length} total points across ${resolutionLevels.length} resolution levels + ${radialRings} radial rings`);

      // 3. Batch requests to the Distance Matrix API with intelligent chunking
      const results = [];
      const chunkSize = 25; // Google Maps API limit
      const maxConcurrentRequests = 3; // Limit concurrent requests to avoid rate limiting
      let processedChunks = 0;
      
      // Split destinations into chunks
      const chunks = [];
      for (let i = 0; i < destinations.length; i += chunkSize) {
        chunks.push(destinations.slice(i, i + chunkSize));
      }
      
      console.log(`Processing ${chunks.length} chunks with max ${maxConcurrentRequests} concurrent requests`);
      
      // Process chunks in batches to avoid overwhelming the API
      for (let batchStart = 0; batchStart < chunks.length; batchStart += maxConcurrentRequests) {
        const currentBatch = chunks.slice(batchStart, batchStart + maxConcurrentRequests);
        
        // Process current batch concurrently
        const batchPromises = currentBatch.map((chunk, chunkIndexInBatch) => {
          const globalChunkIndex = batchStart + chunkIndexInBatch;
          
          return new Promise((resolve, reject) => {
            distanceMatrixService.getDistanceMatrix({
              origins: [origin],
              destinations: chunk,
              travelMode: googleMaps.TravelMode[travelMode],
              unitSystem: googleMaps.UnitSystem.METRIC,
              drivingOptions: travelMode === 'DRIVING' ? {
                departureTime: new Date(),
                trafficModel: googleMaps.TrafficModel.BEST_GUESS
              } : undefined,
            }, (response, status) => {
              if (status === 'OK') {
                resolve({
                  elements: response.rows[0].elements,
                  chunkIndex: globalChunkIndex,
                  startIndex: globalChunkIndex * chunkSize
                });
              } else {
                console.warn(`Chunk ${globalChunkIndex} failed with status: ${status}`);
                resolve({
                  elements: [],
                  chunkIndex: globalChunkIndex,
                  startIndex: globalChunkIndex * chunkSize
                });
              }
            });
          });
        });
        
        // Wait for current batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Process results from this batch
        batchResults.forEach(batchResult => {
          results.push(...batchResult.elements.map((element, idx) => ({
            element,
            destinationIndex: batchResult.startIndex + idx
          })));
          processedChunks++;
          console.log(`Processed chunk ${batchResult.chunkIndex + 1}/${chunks.length}`);
        });
        
        // Add delay between batches to be respectful to the API
        if (batchStart + maxConcurrentRequests < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // 4. Filter the points that are within the max travel time
      const validPoints = [];
      results.forEach((result) => {
        const element = result.element;
        const destinationIndex = result.destinationIndex;
        
        if (element.status === 'OK') {
          // Use duration_in_traffic if available (for driving), otherwise use duration
          const duration = element.duration_in_traffic ? element.duration_in_traffic.value : element.duration.value;
          if (duration <= maxTime * 60) {
            validPoints.push(destinations[destinationIndex]);
          }
        }
      });

      console.log(`Found ${validPoints.length} reachable points out of ${destinations.length} total points (${(validPoints.length/destinations.length*100).toFixed(1)}% reachable)`);

      if (validPoints.length < 3) {
        throw new Error('Not enough reachable points to create an isochrone. Try increasing the travel time or changing the travel mode.');
      }

      // 5. Create a more refined polygon using alpha shapes or better hull algorithm
      let hull;
      
      if (validPoints.length > 50) {
        // For larger datasets, use a more sophisticated approach
        hull = getAlphaShape(validPoints, searchRadiusKm);
      } else {
        // For smaller datasets, use convex hull
        hull = getConvexHull(validPoints);
      }

      const newPolygon = new googleMaps.Polygon({
        paths: hull,
        strokeColor: '#FF6B6B',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#FF6B6B',
        fillOpacity: 0.35,
      });

      newPolygon.setMap(map);
      setIsochronePolygon(newPolygon);
      
      // Fit map to show the isochrone
      const bounds = new googleMaps.LatLngBounds();
      hull.forEach(point => bounds.extend(point));
      map.fitBounds(bounds);

    } catch (e) {
      console.error('Isochrone calculation error:', e);
      setError('An error occurred: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [map, address, maxTime, travelMode, originMarker, isochronePolygon]);

  // Alpha shape algorithm for more natural boundaries with large point sets
  const getAlphaShape = (points, searchRadiusKm) => {
    // For now, we'll use a refined convex hull with boundary smoothing
    // This is a simplified alpha shape approach
    const hull = getConvexHull(points);
    
    // Add intermediate points along the hull edges for smoother curves
    const smoothedHull = [];
    for (let i = 0; i < hull.length; i++) {
      const current = hull[i];
      const next = hull[(i + 1) % hull.length];
      
      smoothedHull.push(current);
      
      // Add intermediate points for longer edges
      const distance = window.google.maps.geometry.spherical.computeDistanceBetween(current, next);
      if (distance > 2000) { // If edge is longer than 2km, add intermediate points
        const bearing = window.google.maps.geometry.spherical.computeHeading(current, next);
        const numIntermediatePoints = Math.min(Math.floor(distance / 1000), 3);
        
        for (let j = 1; j <= numIntermediatePoints; j++) {
          const intermediateDistance = (distance * j) / (numIntermediatePoints + 1);
          const intermediatePoint = window.google.maps.geometry.spherical.computeOffset(
            current, 
            intermediateDistance, 
            bearing
          );
          smoothedHull.push(intermediatePoint);
        }
      }
    }
    
    return smoothedHull;
  };

  // Convex Hull algorithm (Graham Scan variant)
  const getConvexHull = (points) => {
    if (points.length <= 3) return points;

    // Sort points lexicographically by latitude, then longitude
    points.sort((a, b) => a.lat() - b.lat() || a.lng() - b.lng());

    // Function to determine if a turn is left or right
    const crossProduct = (p1, p2, p3) => 
      (p2.lng() - p1.lng()) * (p3.lat() - p1.lat()) - (p2.lat() - p1.lat()) * (p3.lng() - p1.lng());

    const lower = [];
    for (const p of points) {
      while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    // Combine the lower and upper hulls, removing duplicate points at the ends
    return lower.slice(0, lower.length - 1).concat(upper.slice(0, upper.length - 1));
  };

  const onLoad = useCallback((map) => {
    setMap(map);
    setIsLoaded(true);
  }, []);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      {/* Control Panel */}
      <div style={{ width: '350px', padding: '20px', backgroundColor: '#f8f9fa', borderRight: '1px solid #dee2e6' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', textAlign: 'center', marginBottom: '16px', color: '#333' }}>
            Isochrone Map Generator
          </h1>
          <p style={{ fontSize: '14px', textAlign: 'center', color: '#666', marginBottom: '20px' }}>
            Visualize the area reachable within a certain travel time from a given location.
          </p>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#333', marginBottom: '4px' }}>
              Origin Address
            </label>
            <input
              type="text"
              style={{ 
                width: '100%', 
                padding: '12px', 
                borderRadius: '6px', 
                border: '2px solid #e9ecef', 
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              placeholder="e.g., San Francisco, CA"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={loading}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#333', marginBottom: '4px' }}>
              Max Travel Time (minutes)
            </label>
            <input
              type="number"
              style={{ 
                width: '100%', 
                padding: '12px', 
                borderRadius: '6px', 
                border: '2px solid #e9ecef', 
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              min="1"
              max="120"
              value={maxTime}
              onChange={(e) => setMaxTime(parseInt(e.target.value))}
              disabled={loading}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#333', marginBottom: '4px' }}>
              Travel Mode
            </label>
            <select
              style={{ 
                width: '100%', 
                padding: '12px', 
                borderRadius: '6px', 
                border: '2px solid #e9ecef', 
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              value={travelMode}
              onChange={(e) => setTravelMode(e.target.value)}
              disabled={loading}
            >
              <option value="DRIVING">Driving</option>
              <option value="WALKING">Walking</option>
              <option value="BICYCLING">Bicycling</option>
              <option value="TRANSIT">Transit</option>
            </select>
          </div>

          <button
            onClick={findIsochrone}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '6px',
              backgroundColor: loading ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              fontSize: '16px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.3s'
            }}
            disabled={loading}
          >
            {loading ? 'Calculating...' : 'Generate Isochrone Map'}
          </button>
          
          {error && (
            <div style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '6px',
              fontSize: '14px',
              textAlign: 'center'
            }}>
              {error}
            </div>
          )}
          
          {originLocation && !loading && (
            <div style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#d4edda',
              color: '#155724',
              borderRadius: '6px',
              fontSize: '14px',
              textAlign: 'center'
            }}>
              Isochrone generated successfully!
            </div>
          )}
        </div>
      </div>

      {/* Map Container */}
      <div style={{ flex: 1 }}>
        <LoadScript 
          googleMapsApiKey={GOOGLE_MAPS_API_KEY}
          libraries={['geometry']}
        >
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={defaultCenter}
            zoom={12}
            onLoad={onLoad}
            onUnmount={onUnmount}
            options={{
              disableDefaultUI: true,
              zoomControl: true,
              gestureHandling: "greedy",
            }}
          />
        </LoadScript>
      </div>
    </div>
  );
}

export default App;
