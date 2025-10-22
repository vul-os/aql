import React, { useState } from 'react';
import LoadingMower from './loading-mower';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Button } from './button';

/**
 * Demo page to showcase the LoadingMower component
 * This can be removed after testing or kept for documentation
 */
const LoadingMowerDemo = () => {
  const [size, setSize] = useState('md');
  const [showMessage, setShowMessage] = useState(true);

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">🤖 Loading Mower Animation</h1>
          <p className="text-muted-foreground">
            A custom robotic lawn mower loading animation for BotKorp
          </p>
        </div>

        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <CardDescription>Customize the loading animation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Size</label>
              <div className="flex gap-2">
                <Button
                  variant={size === 'sm' ? 'default' : 'outline'}
                  onClick={() => setSize('sm')}
                >
                  Small
                </Button>
                <Button
                  variant={size === 'md' ? 'default' : 'outline'}
                  onClick={() => setSize('md')}
                >
                  Medium
                </Button>
                <Button
                  variant={size === 'lg' ? 'default' : 'outline'}
                  onClick={() => setSize('lg')}
                >
                  Large
                </Button>
              </div>
            </div>
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
          </CardHeader>
          <CardContent className="min-h-[400px] flex items-center justify-center bg-muted/50">
            <LoadingMower
              size={size}
              message={showMessage ? "Mowing in progress..." : undefined}
            />
          </CardContent>
        </Card>

        {/* Usage Examples */}
        <Card>
          <CardHeader>
            <CardTitle>Usage Examples</CardTitle>
            <CardDescription>How to use this component in your app</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Basic Usage:</h3>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import LoadingMower from '@/components/ui/loading-mower';

<LoadingMower message="Loading..." />`}
              </pre>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Full Page Loading:</h3>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`if (loading) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <LoadingMower 
        message="Loading your dashboard..." 
        size="lg"
      />
    </div>
  );
}`}
              </pre>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Modal/Overlay Loading:</h3>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{loading && (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 
                  flex items-center justify-center">
    <Card className="p-8">
      <LoadingMower 
        message="Processing your request..." 
        size="md"
      />
    </Card>
  </div>
)}`}
              </pre>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Inline Loading:</h3>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`<LoadingMower size="sm" className="my-4" />`}
              </pre>
            </div>
          </CardContent>
        </Card>

        {/* Different Message Examples */}
        <Card>
          <CardHeader>
            <CardTitle>Message Variations</CardTitle>
            <CardDescription>Different use cases with contextual messages</CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-6">
            <div className="border rounded-lg p-6 bg-card">
              <LoadingMower size="sm" message="Creating service..." />
            </div>
            <div className="border rounded-lg p-6 bg-card">
              <LoadingMower size="sm" message="Processing payment..." />
            </div>
            <div className="border rounded-lg p-6 bg-card">
              <LoadingMower size="sm" message="Generating invoice..." />
            </div>
            <div className="border rounded-lg p-6 bg-card">
              <LoadingMower size="sm" message="Loading bot status..." />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoadingMowerDemo;


