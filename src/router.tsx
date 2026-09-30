import { createBrowserRouter } from 'react-router-dom'

import { RootLayout } from '@/components/shared/layout/RootLayout'
import { SimulationFormPage } from '@/pages/SimulationFormPage'

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        path: '/',
        element: <SimulationFormPage />,
      },
    ],
  },
])