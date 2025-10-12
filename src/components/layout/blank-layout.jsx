import React from 'react'
import { Outlet } from 'react-router-dom'

const BlankLayout = () => {
  return (
    <div className="min-h-screen">
      <Outlet />
    </div>
  )
}

export default BlankLayout
