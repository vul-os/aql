import React, { useState, useRef, useEffect } from 'react';
import { Search, MapPin, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.YOUR_MAPBOX_TOKEN_HERE';

export function AddressSearch({ 
  onAddressSelect, 
  placeholder = "Search for an address...",
  className,
  defaultValue = "",
  storageKey = "lastSearchedAddress" // localStorage key
}) {
  // Load from localStorage on mount
  const [query, setQuery] = useState(() => {
    if (defaultValue) return defaultValue;
    const saved = localStorage.getItem(storageKey);
    return saved || '';
  });
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchAddresses = async (searchQuery) => {
    if (!searchQuery || searchQuery.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);

    try {
      // Mapbox Geocoding API with focus on South Africa
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?` +
        `access_token=${MAPBOX_TOKEN}&` +
        `country=ZA&` + // Limit to South Africa
        `types=address,place,postcode,locality&` +
        `limit=5&` +
        `autocomplete=true`
      );

      if (!response.ok) {
        throw new Error('Geocoding failed');
      }

      const data = await response.json();
      
      // Format the results
      const formattedSuggestions = data.features.map((feature) => ({
        id: feature.id,
        place_name: feature.place_name,
        text: feature.text,
        address: feature.address || '',
        center: feature.center, // [longitude, latitude]
        context: feature.context || [],
        // Extract useful info from context
        city: feature.context?.find(c => c.id.includes('place'))?.text || '',
        province: feature.context?.find(c => c.id.includes('region'))?.text || '',
        postal_code: feature.context?.find(c => c.id.includes('postcode'))?.text || '',
        country: feature.context?.find(c => c.id.includes('country'))?.text || 'South Africa'
      }));

      setSuggestions(formattedSuggestions);
      setShowDropdown(true);
    } catch (error) {
      console.error('Address search error:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    setSelectedIndex(-1);
    
    // Save to localStorage
    localStorage.setItem(storageKey, value);

    // Debounce the search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      searchAddresses(value);
    }, 300);
  };

  const handleSelectAddress = (address) => {
    setQuery(address.place_name);
    setSuggestions([]);
    setShowDropdown(false);
    
    // Save selected address to localStorage
    localStorage.setItem(storageKey, address.place_name);
    localStorage.setItem(`${storageKey}_full`, JSON.stringify({
      ...address,
      fullAddress: address.place_name,
      latitude: address.center[1],
      longitude: address.center[0]
    }));
    
    if (onAddressSelect) {
      onAddressSelect({
        ...address,
        fullAddress: address.place_name,
        latitude: address.center[1],
        longitude: address.center[0]
      });
    }
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setShowDropdown(false);
    localStorage.removeItem(storageKey);
    localStorage.removeItem(`${storageKey}_full`);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelectAddress(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSuggestions([]);
        break;
    }
  };

  return (
    <div ref={dropdownRef} className={cn("relative w-full", className)}>
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) {
                setShowDropdown(true);
              }
            }}
            className="pl-9 pr-9"
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-3 h-4 w-4 text-muted-foreground animate-spin" />
          )}
        </div>
        {query && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleClear}
            title="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-[300px] overflow-auto">
          <ul className="py-1">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                onClick={() => handleSelectAddress(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  "px-3 py-2 cursor-pointer transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  selectedIndex === index && "bg-accent text-accent-foreground"
                )}
              >
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {suggestion.text}
                      {suggestion.address && ` ${suggestion.address}`}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[suggestion.city, suggestion.province, suggestion.postal_code]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* No results message */}
      {showDropdown && !isLoading && query.length >= 3 && suggestions.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg p-3">
          <p className="text-sm text-muted-foreground text-center">
            No addresses found. Try a different search.
          </p>
        </div>
      )}
    </div>
  );
}

