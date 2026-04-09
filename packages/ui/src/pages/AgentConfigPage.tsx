import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentConfigApi } from "../api";
import { AgentConfig, LlmProviderInfo, AGENT_META, AgentName } from "../types";
import {
  Settings,
  Save,
  CheckCircle2,
  Loader2,
  Zap,
  FileText,
  ShieldCheck,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

export default function AgentConfigPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const [formData, setFormData] = useState<Partial<AgentConfig>>({});
  const [saved, setSaved] = useState(false);
  // Raw text state for the agentCard textarea (tracks in-progress edits)
  const [agentCardRaw, setAgentCardRaw] = useState("");
  const [cardValidation, setCardValidation] = useState<{
    status: "idle" | "valid" | "error";
    message: string;
  }>({ status: "idle", message: "" });

  const REQUIRED_CARD_FIELDS = [
    "schemaVersion",
    "humanReadableId",
    "name",
    "description",
    "authSchemes",
  ] as const;

  function validateCardJson(raw: string): {
    status: "valid" | "error";
    message: string;
    parsed?: Record<string, any>;
  } {
    if (raw.trim() === "") {
      return {
        status: "valid",
        message: "Empty — generated defaults will be used.",
      };
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      return { status: "error", message: `Invalid JSON: ${e.message}` };
    }
    if (
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed === null
    ) {
      return {
        status: "error",
        message: "Agent Card must be a JSON object, not an array or primitive.",
      };
    }
    const missing = REQUIRED_CARD_FIELDS.filter((f) => !parsed[f]);
    if (missing.length > 0) {
      return {
        status: "error",
        message: `Missing required fields: ${missing.join(", ")}`,
      };
    }
    if (!Array.isArray(parsed.authSchemes) || parsed.authSchemes.length === 0) {
      return {
        status: "error",
        message: "authSchemes must be a non-empty array.",
      };
    }
    return { status: "valid", message: "Agent Card JSON is valid ✓", parsed };
  }

  // Fetch providers and all configs
  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ["llm-providers"],
    queryFn: agentConfigApi.getProviders,
  });

  const { data: allConfigs, isLoading: configsLoading } = useQuery({
    queryKey: ["all-agent-configs"],
    queryFn: agentConfigApi.getAllConfigs,
  });

  const { data: currentConfig, isLoading: currentConfigLoading } = useQuery({
    queryKey: ["agent-config", selectedAgent],
    queryFn: () =>
      selectedAgent
        ? agentConfigApi.getConfig(selectedAgent)
        : Promise.resolve(null),
    enabled: !!selectedAgent,
  });

  // Update config mutation
  const { mutate: updateConfig, isPending: isUpdating } = useMutation({
    mutationFn: (data: Partial<AgentConfig>) =>
      agentConfigApi.updateConfig(selectedAgent || "", data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-config", selectedAgent],
      });
      queryClient.invalidateQueries({ queryKey: ["all-agent-configs"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // Update form when current config loads
  useEffect(() => {
    if (currentConfig) {
      const cardStr = currentConfig.agentCard
        ? JSON.stringify(currentConfig.agentCard, null, 2)
        : "";
      setFormData({
        provider: currentConfig.provider,
        model: currentConfig.model,
        systemPrompt: currentConfig.systemPrompt,
        temperature: currentConfig.temperature,
        maxTokens: currentConfig.maxTokens,
        agentCard: currentConfig.agentCard ?? null,
      });
      setAgentCardRaw(cardStr);
      setCardValidation({ status: "idle", message: "" });
    }
  }, [currentConfig]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent) return;
    // Block save if the raw textarea has invalid JSON
    const validation = validateCardJson(agentCardRaw);
    if (validation.status === "error") {
      setCardValidation(validation);
      return;
    }
    updateConfig(formData);
  };

  const getAvailableModels = (): string[] => {
    if (!providers || !formData.provider) return [];
    const provider = providers.find(
      (p: LlmProviderInfo) => p.id === formData.provider,
    );
    return provider?.models || [];
  };

  const agents = Object.keys(AGENT_META) as AgentName[];
  const isLoading = providersLoading || configsLoading || currentConfigLoading;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-slate-400" />
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">
            {t("pages.config.title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {t("pages.config.subtitle")}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 size={32} className="text-indigo-400 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent List */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Zap size={14} />
              {t("pages.config.agents")}
            </h2>
            <div className="space-y-2">
              {agents.map((agent) => {
                const meta = AGENT_META[agent];
                const config = allConfigs?.[agent];
                const isSelected = selectedAgent === agent;

                return (
                  <button
                    key={agent}
                    onClick={() => {
                      setSelectedAgent(agent);
                      setSaved(false);
                    }}
                    className={clsx(
                      "w-full text-left p-3 rounded-lg border transition-all",
                      isSelected
                        ? "bg-indigo-500/10 border-indigo-500/50"
                        : "bg-slate-800/50 border-slate-700 hover:border-slate-600",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-lg mt-0.5">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-200 text-sm">
                          {meta.label}
                        </div>
                        <div className="text-xs text-slate-500 leading-tight mt-1">
                          {meta.description}
                        </div>
                        {config && (
                          <div className="text-xs text-indigo-400 mt-1.5 flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
                            {config.provider} · {config.model}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration Form */}
          {selectedAgent && currentConfig ? (
            <div className="lg:col-span-2">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="card p-5 space-y-4">
                  {/* Agent Header */}
                  <div className="flex items-center gap-3 pb-4 border-b border-slate-700">
                    <span className="text-2xl">
                      {AGENT_META[selectedAgent].icon}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-100">
                        {AGENT_META[selectedAgent].label}
                      </div>
                      <div className="text-xs text-slate-500">
                        {selectedAgent}
                      </div>
                    </div>
                  </div>

                  {/* LLM Provider */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      {t("pages.config.provider")}
                    </label>
                    <select
                      value={formData.provider || "anthropic"}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          provider: e.target.value as any,
                          model: "", // Reset model when provider changes
                        });
                      }}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    >
                      {providers?.map((p: LlmProviderInfo) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* LLM Model */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      {t("pages.config.model")}
                    </label>
                    <select
                      value={formData.model || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, model: e.target.value })
                      }
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">{t("pages.config.selectModel")}</option>
                      {getAvailableModels().map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <div className="text-xs text-slate-500 mt-1">
                      Available models for {formData.provider}
                    </div>
                  </div>

                  {/* Temperature & Max Tokens */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        {t("pages.config.temperature")}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={formData.temperature || 0.7}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            temperature: parseFloat(e.target.value),
                          })
                        }
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        Randomness (0-2)
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        {t("pages.config.maxTokens")}
                      </label>
                      <input
                        type="number"
                        step="256"
                        min="512"
                        max="128000"
                        value={formData.maxTokens || 4096}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            maxTokens: parseInt(e.target.value),
                          })
                        }
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        Response length limit
                      </div>
                    </div>
                  </div>

                  {/* System Prompt */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      {t("pages.config.systemPrompt")}
                    </label>
                    <textarea
                      value={formData.systemPrompt || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          systemPrompt: e.target.value,
                        })
                      }
                      rows={5}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 font-mono"
                      placeholder="Enter system prompt for this agent..."
                    />
                    <div className="text-xs text-slate-500 mt-1">
                      This prompt guides the agent's behavior and
                      decision-making
                    </div>
                  </div>

                  {/* Agent Card JSON */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-slate-300 flex items-center gap-1.5">
                        <FileText size={13} />
                        Agent Card (JSON)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const result = validateCardJson(agentCardRaw);
                          setCardValidation(result);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-slate-600 hover:bg-slate-500 text-slate-200 transition-colors"
                      >
                        <ShieldCheck size={12} />
                        Validate
                      </button>
                    </div>
                    <textarea
                      value={agentCardRaw}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setAgentCardRaw(raw);
                        setCardValidation({ status: "idle", message: "" });
                        try {
                          const parsed =
                            raw.trim() === "" ? null : JSON.parse(raw);
                          setFormData({ ...formData, agentCard: parsed });
                        } catch {
                          // Keep raw text so user can keep typing
                          setFormData({ ...formData, agentCard: null });
                        }
                      }}
                      rows={12}
                      spellCheck={false}
                      className={clsx(
                        "w-full bg-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none font-mono border",
                        cardValidation.status === "error"
                          ? "border-red-500 focus:border-red-400"
                          : cardValidation.status === "valid"
                            ? "border-green-500 focus:border-green-400"
                            : "border-slate-600 focus:border-indigo-500",
                      )}
                      placeholder={`{\n  "schemaVersion": "1.0",\n  "humanReadableId": "...",\n  "name": "...",\n  "description": "...",\n  "authSchemes": [...]\n}`}
                    />
                    {cardValidation.status !== "idle" && (
                      <div
                        className={clsx(
                          "flex items-start gap-1.5 mt-1.5 text-xs rounded-md px-2.5 py-1.5",
                          cardValidation.status === "error"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-green-500/10 text-green-400",
                        )}
                      >
                        {cardValidation.status === "error" ? (
                          <AlertTriangle
                            size={12}
                            className="mt-0.5 shrink-0"
                          />
                        ) : (
                          <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                        )}
                        <span>{cardValidation.message}</span>
                      </div>
                    )}
                    <div className="text-xs text-slate-500 mt-1">
                      Required fields: schemaVersion, humanReadableId, name,
                      description, authSchemes. Leave blank to use generated
                      defaults.
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-4">
                    <button
                      type="submit"
                      disabled={isUpdating}
                      className={clsx(
                        "flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all",
                        "bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                    >
                      {isUpdating ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {t("pages.config.saving")}
                        </>
                      ) : (
                        <>
                          <Save size={14} />
                          {t("pages.config.saveConfiguration")}
                        </>
                      )}
                    </button>
                    {saved && (
                      <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm">
                        <CheckCircle2 size={14} />
                        {t("pages.config.saved")}
                      </div>
                    )}
                  </div>
                </div>
              </form>
            </div>
          ) : (
            <div className="lg:col-span-2 card p-8 flex items-center justify-center text-slate-500">
              <p className="text-center">{t("pages.config.selectAgent")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
