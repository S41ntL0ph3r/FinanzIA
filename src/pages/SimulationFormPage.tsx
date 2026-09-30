import { SimulationForm } from '@/components/shared/features/Simulation/form'
import { SimulationHero } from '@/components/shared/features/Simulation/hero'

export function SimulationFormPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-14">
      <SimulationHero />
      <SimulationForm />
    </main>
  )
}