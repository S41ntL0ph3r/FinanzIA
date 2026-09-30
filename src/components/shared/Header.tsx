import { Moon, Sun, TrendingUp, Wallet } from 'lucide-react'
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/shared/Button"
import { useTheme } from "@/hooks/useTheme"

export function Header() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="border-b border-(--border) px-3 py-3 sm:px-6">
  <nav className="flex min-w-0 flex-wrap items-center justify-between gap-2">
    {/* Logo */}

    <div className="flex min-w-0 items-center gap-2">
      <div className="bg-primary flex h-9 w-9 items-center justify-center rounded-full">
        <Wallet size={20} className="text-primary-foreground" />
      </div>
      <span className="text-lg">
        <span className="text-muted-foreground font-medium">Finanz</span>
        <span className="font-extrabold">.IA</span>
      </span>
    </div>

    {/* Action Buttons */}

    {/* Actions Buttons */}
    <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
      <Button
        variant="secondary"
        icon={TrendingUp}
        onClick={() => void navigate('/')}
      >
     <span className="hidden sm:inline">Nova Análise</span>
      </Button>
    <Button
      aria-label={`Mudar para tema ${theme === 'light' ? 'escuro' : 'claro'}`}
      variant="ghost"
      icon={theme === 'light' ? Moon : Sun}
      onClick={toggleTheme}
    />

    </div>

  </nav>
  </header>
  )
}