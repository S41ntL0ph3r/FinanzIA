import { PiggyBank } from 'lucide-react'

export function SimulationHero() {
  return (
    <div className="mb-8 text-center">
      <div className="flex flex-col items-center gap-2 sm:flex-row">
        <h1 className="text-foreground text-3xl font-semibold sm:text-4xl">
          Vamos planejar seu futuro
        </h1>
        <PiggyBank
          aria-hidden
          className="h-16 w-16 fill-none text-foreground [&>path:first-child]:fill-pink-500 sm:-mt-2 sm:-ml-3"
          strokeWidth={1.5}
        />
      </div>
      <p className="text-muted-foreground text-sm">
        Responda algumas questões para ter insights financeiros personalizados.
      </p>
    </div>
  )
}