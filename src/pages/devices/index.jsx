import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

const DevicesPage = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Smart Devices</h1>
          <p className="text-gray-600">Control your smart home devices from one central platform</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Device
        </Button>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
          <CardDescription>Smart device management features are being developed</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            This page will allow you to:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-gray-600">
            <li>Add and configure smart devices (lights, plugs, AC, TV, etc.)</li>
            <li>Control devices remotely</li>
            <li>Create automation schedules</li>
            <li>Set up device groups and scenes</li>
            <li>Monitor device status and energy usage</li>
            <li>Integrate with voice assistants</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

export default DevicesPage
