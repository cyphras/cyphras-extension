import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Check } from 'lucide-react'

const LANGUAGES = [{ code: 'en', label: 'English' }]

export default function SettingsPreferencesLanguage() {
  const navigate = useNavigate()

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Language</h2>
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          {LANGUAGES.map(({ code, label }) => (
            <div key={code} className="flex items-center gap-3 px-4 py-3">
              <p className="flex-1 text-sm font-medium text-foreground">{label}</p>
              <Check size={16} className="text-primary flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}
