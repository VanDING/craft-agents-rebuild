import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Key, Monitor, Network } from "lucide-react"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"

import claudeIcon from "@/assets/provider-icons/claude.svg"
import openaiIcon from "@/assets/provider-icons/openai.svg"
import copilotIcon from "@/assets/provider-icons/copilot.svg"
import xaiIcon from "@/assets/provider-icons/xai.svg"
import openrouterIcon from "@/assets/provider-icons/openrouter.svg"
import kimiIcon from "@/assets/provider-icons/kimi.svg"

/**
 * The high-level provider choice the user makes on first launch.
 * This maps to one or more ApiSetupMethods downstream.
 */
export type ProviderChoice = 'claude' | 'chatgpt' | 'copilot' | 'xai' | 'openrouter' | 'kimi' | 'radius' | 'api_key' | 'local'

interface ProviderOption {
  id: ProviderChoice
  name: string
  description: string
  icon: React.ReactNode
}

const PROVIDER_ICONS: Record<ProviderChoice, React.ReactNode> = {
  claude: <img src={claudeIcon} alt="" className="size-6 rounded-[4px]" />,
  chatgpt: <img src={openaiIcon} alt="" className="size-6 rounded-[4px]" />,
  copilot: <img src={copilotIcon} alt="" className="size-6 rounded-[4px]" />,
  xai: <img src={xaiIcon} alt="" className="size-6 rounded-[4px]" />,
  openrouter: <img src={openrouterIcon} alt="" className="size-6" />,
  kimi: <img src={kimiIcon} alt="" className="size-6" />,
  radius: <Network className="size-6" />,
  api_key: <Key className="size-6" />,
  local: <Monitor className="size-6" />,
}

interface ProviderSelectStepProps {
  /** Called when the user selects a provider */
  onSelect: (choice: ProviderChoice) => void
  /** Called when the user chooses to skip setup */
  onSkip?: () => void
}

/**
 * ProviderSelectStep — First screen after install.
 *
 * Welcomes the user and asks them to pick their subscription / auth method.
 * Selecting a card immediately advances to the next step.
 */
export function ProviderSelectStep({ onSelect, onSkip }: ProviderSelectStepProps) {
  const { t } = useTranslation()

  const PROVIDER_OPTIONS: ProviderOption[] = [
    {
      id: 'claude',
      name: t("onboarding.providerSelect.claudeProMax"),
      description: t("onboarding.providerSelect.claudeProMaxDesc"),
      icon: PROVIDER_ICONS.claude,
    },
    {
      id: 'chatgpt',
      name: t("onboarding.providerSelect.codexChatGPT"),
      description: t("onboarding.providerSelect.codexChatGPTDesc"),
      icon: PROVIDER_ICONS.chatgpt,
    },
    {
      id: 'copilot',
      name: t("onboarding.providerSelect.githubCopilot"),
      description: t("onboarding.providerSelect.githubCopilotDesc"),
      icon: PROVIDER_ICONS.copilot,
    },
    {
      id: 'xai',
      name: t("onboarding.providerSelect.xai"),
      description: t("onboarding.providerSelect.xaiDesc"),
      icon: PROVIDER_ICONS.xai,
    },
    {
      id: 'openrouter',
      name: t("onboarding.providerSelect.openrouter"),
      description: t("onboarding.providerSelect.openrouterDesc"),
      icon: PROVIDER_ICONS.openrouter,
    },
    {
      id: 'kimi',
      name: t("onboarding.providerSelect.kimi"),
      description: t("onboarding.providerSelect.kimiDesc"),
      icon: PROVIDER_ICONS.kimi,
    },
    {
      id: 'radius',
      name: t("onboarding.providerSelect.radius"),
      description: t("onboarding.providerSelect.radiusDesc"),
      icon: PROVIDER_ICONS.radius,
    },
    {
      id: 'api_key',
      name: t("onboarding.providerSelect.otherProvider"),
      description: 'Anthropic, AWS Bedrock, OpenRouter, Google or any compatible provider.',
      icon: PROVIDER_ICONS.api_key,
    },
    {
      id: 'local',
      name: t("onboarding.providerSelect.localModel"),
      description: 'Run models locally with Ollama.',
      icon: PROVIDER_ICONS.local,
    },
  ]

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={t("onboarding.providerSelect.title")}
      description={t("onboarding.providerSelect.description")}
      className="max-w-[42rem]">
      <div className="grid grid-cols-3 gap-3">
        {PROVIDER_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            className={cn(
              "motion-content flex flex-col items-center gap-2 rounded-xl bg-foreground-2 p-4 text-center transition-[color,background-color,border-color,box-shadow,opacity,transform]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "hover:bg-foreground/[0.02] shadow-minimal cursor-pointer"
            )}
          >
            {/* Icon */}
            <div className="flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {option.icon}
            </div>

            {/* Content */}
            <div className="min-w-0">
              <span className="block font-medium text-sm">{option.name}</span>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">
                {option.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {onSkip && (
        <div className="mt-4 text-center">
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("onboarding.providerSelect.setupLater")}
          </button>
        </div>
      )}
    </StepFormLayout>
  )
}
