import React, { useState } from 'react';
import LoadingLottie from './loading-lottie';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

/**
 * Demo page for Lottie animations
 * Shows how to use Lottie animations with different URLs
 */
const LoadingLottieDemo = () => {
  const [size, setSize] = useState('md');
  const [showMessage, setShowMessage] = useState(true);
  const [selectedAnimation, setSelectedAnimation] = useState('robot');
  const [customUrl, setCustomUrl] = useState('');

  // Curated animations that work well for loading screens
  const animations = {
    robot: {
      name: 'Robot Loading',
      url: 'https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie',
      description: 'The one you found! A cute robot animation'
    },
    // Add more as you find them
    custom: {
      name: 'Custom URL',
      url: customUrl,
      description: 'Use your own Lottie URL'
    }
  };

  const currentAnimation = selectedAnimation === 'custom' 
    ? animations.custom 
    : animations[selectedAnimation];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">🎬 Lottie Animations</h1>
          <p className="text-muted-foreground">
            Professional loading animations from LottieFiles
          </p>
        </div>

        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <CardDescription>Customize the animation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Animation Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Select Animation</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(animations).map(([key, anim]) => (
                  <Button
                    key={key}
                    variant={selectedAnimation === key ? 'default' : 'outline'}
                    onClick={() => setSelectedAnimation(key)}
                  >
                    {anim.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom URL Input */}
            {selectedAnimation === 'custom' && (
              <div>
                <Label htmlFor="custom-url">Custom Lottie URL</Label>
                <Input
                  id="custom-url"
                  placeholder="https://lottie.host/xxx/xxx.lottie"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Go to lottiefiles.com, find an animation, and paste the URL here
                </p>
              </div>
            )}

            {/* Size Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Size</label>
              <div className="flex gap-2">
                {['sm', 'md', 'lg', 'xl'].map((s) => (
                  <Button
                    key={s}
                    variant={size === s ? 'default' : 'outline'}
                    onClick={() => setSize(s)}
                  >
                    {s.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Show Message Toggle */}
            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showMessage}
                  onChange={(e) => setShowMessage(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Show message</span>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {currentAnimation.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-[500px] flex items-center justify-center bg-muted/50">
            <LoadingLottie
              src={currentAnimation.url}
              size={size}
              message={showMessage ? "Loading your dashboard..." : undefined}
            />
          </CardContent>
        </Card>

        {/* Usage Guide */}
        <Card>
          <CardHeader>
            <CardTitle>How to Use This Animation</CardTitle>
            <CardDescription>Copy and paste this code</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">1. Import the component:</h3>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import LoadingLottie from '@/components/ui/loading-lottie';`}
              </pre>
            </div>

            <div>
              <h3 className="font-semibold mb-2">2. Use it in your component:</h3>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`<LoadingLottie
  src="${currentAnimation.url}"
  message="Loading..."
  size="${size}"
/>`}
              </pre>
            </div>

            <div>
              <h3 className="font-semibold mb-2">3. Full page example:</h3>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`if (loading) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <LoadingLottie
        src="${currentAnimation.url}"
        message="Loading your dashboard..."
        size="lg"
      />
    </div>
  );
}`}
              </pre>
            </div>
          </CardContent>
        </Card>

        {/* How to Find More */}
        <Card>
          <CardHeader>
            <CardTitle>🎨 How to Find More Animations</CardTitle>
            <CardDescription>Get professional animations for free</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Step 1: Go to LottieFiles</h3>
              <a 
                href="https://lottiefiles.com/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                https://lottiefiles.com/ →
              </a>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Step 2: Search for animations</h3>
              <p className="text-sm text-muted-foreground">
                Try searching: "robot loading", "lawn mower", "tech loading", "robot animation", "gardening"
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Step 3: Get the URL</h3>
              <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                <li>Click on an animation you like</li>
                <li>Look for "Lottie Animation URL" or click "Embed"</li>
                <li>Copy the URL (looks like: https://lottie.host/xxx/xxx.lottie)</li>
                <li>Paste it in the code above!</li>
              </ol>
            </div>

            <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
              <p className="text-sm font-semibold mb-2">💡 Pro Tip:</p>
              <p className="text-sm text-muted-foreground">
                Look for animations with "loading" or "loop" in the name - they're designed to loop smoothly!
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoadingLottieDemo;

