import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ReActStep } from '../types';
import {
  Send,
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
  AlertCircle,
  HelpCircle
} from 'lucide-react';

interface ChatInterfaceProps {
  onSendMessage: (query: string) => Promise<ChatMessage>;
  chatHistory: ChatMessage[];
  isLoading: boolean;
  onClearHistory: () => void;
}

export default function ChatInterface({
  onSendMessage,
  chatHistory,
  isLoading,
  onClearHistory,
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Predefined queries based on test scenarios
  const presets = [
    {
      label: 'Расходы на 30 дней',
      query: 'Сколько я потрачу в ближайшие 30 дней? Покажи итог в рублях.',
    },
    {
      label: 'Самая дорогая категория',
      query: 'Какая категория подписок обходится мне дороже всего и почему?',
    },
    {
      label: 'Платежи на этой неделе',
      query: 'Есть ли у меня какие-нибудь платежи на этой неделе?',
    },
  ];

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const queryText = input;
    setInput('');
    await onSendMessage(queryText);
  };

  const handlePresetClick = async (query: string) => {
    if (isLoading) return;
    await onSendMessage(query);
  };

  const toggleSteps = (msgId: string) => {
    setExpandedSteps((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col h-[650px] shadow-sm relative" id="chat-interface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4" id="chat-header">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
            <Cpu size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1 font-display">
              ИИ-Аналитик Реестра
              <span className="text-[10px] bg-indigo-50 text-indigo-600 font-mono px-1.5 py-0.5 rounded border border-indigo-100 font-semibold">ReAct Agent</span>
            </h2>
            <p className="text-[10px] text-slate-500">Рассуждающий агент на базе GigaChat</p>
          </div>
        </div>
        <button
          onClick={onClearHistory}
          className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-all cursor-pointer"
          id="btn-clear-chat"
        >
          Очистить
        </button>
      </div>

      {/* Preset Questions Panel */}
      <div className="mb-4" id="presets-panel">
        <p className="text-[10px] text-slate-500 mb-2 font-medium flex items-center gap-1">
          <HelpCircle size={12} className="text-slate-400" />
          Быстрые сценарии тестирования (из тестового задания):
        </p>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset, index) => (
            <button
              key={index}
              disabled={isLoading}
              onClick={() => handlePresetClick(preset.query)}
              className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-[10px] text-slate-600 rounded-lg border border-slate-200 hover:border-slate-300 transition-all text-left max-w-xs truncate cursor-pointer disabled:opacity-50"
              title={preset.query}
              id={`preset-btn-${index}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1" id="chat-messages">
        {chatHistory.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3" id="chat-welcome">
            <div className="p-4 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100 animate-pulse">
              <Sparkles size={32} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 font-display">Задайте финансовый вопрос</h3>
              <p className="text-xs text-slate-500 max-w-xs mt-1">
                ИИ-агент автоматически выполнит поиск по вашему реестру, сделает разбийку по категориям и сконвертирует валюты по курсу Frankfurter API.
              </p>
            </div>
          </div>
        ) : (
          chatHistory.map((msg) => {
            const isAgent = msg.sender === 'agent';
            const isSystem = msg.sender === 'system';
            const hasSteps = msg.steps && msg.steps.length > 0;
            const isExpanded = expandedSteps[msg.id] ?? true; // Default expanded

            return (
              <div
                key={msg.id}
                className={`flex flex-col space-y-1.5 ${
                  isAgent ? 'items-start' : isSystem ? 'items-center' : 'items-end'
                }`}
                id={`message-${msg.id}`}
              >
                <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
                  <span>{isAgent ? 'ИИ-Агент' : isSystem ? 'Система' : 'Вы'}</span>
                  <span>•</span>
                  <span>{new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                    isAgent
                      ? 'bg-slate-100 text-slate-800 border border-slate-200/60 rounded-tl-sm'
                      : isSystem
                      ? 'bg-amber-50 text-amber-800 border border-amber-200 text-center rounded-lg'
                      : 'bg-indigo-600 text-white rounded-tr-sm shadow-md'
                  }`}
                >
                  <p className="whitespace-pre-line">{msg.text}</p>
                </div>

                {/* Collapsible ReAct Step Log */}
                {isAgent && hasSteps && (
                  <div className="w-full bg-slate-50 border border-slate-200/80 rounded-xl overflow-hidden mt-2 shadow-sm" id={`steps-${msg.id}`}>
                    <button
                      onClick={() => toggleSteps(msg.id)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-100/50 text-[10px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-b border-slate-200 transition-all font-mono"
                      id={`btn-toggle-steps-${msg.id}`}
                    >
                      <span className="flex items-center gap-1.5 text-indigo-600">
                        <Terminal size={12} />
                        Трейс рассуждений ReAct ({msg.steps?.length} шагов)
                      </span>
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {isExpanded && (
                      <div className="p-3.5 space-y-3 font-mono text-[10px] leading-relaxed bg-white divide-y divide-slate-100 max-h-96 overflow-y-auto">
                        {msg.steps?.map((step, idx) => (
                          <div key={step.id} className={`pt-2.5 first:pt-0 space-y-1.5`}>
                            <div className="text-slate-400 text-[9px] font-semibold uppercase">Шаг {idx + 1}</div>
                            {step.thought && (
                              <div className="flex gap-1.5">
                                <span className="text-emerald-600 font-bold select-none">Thought:</span>
                                <span className="text-slate-700">{step.thought}</span>
                              </div>
                            )}
                            {step.action && (
                              <div className="flex flex-col gap-1.5 bg-slate-50 p-2 rounded border border-slate-200/60">
                                <div className="flex gap-1.5">
                                  <span className="text-amber-600 font-bold select-none">Action:</span>
                                  <span className="text-slate-900 font-semibold">
                                    {step.action.name}({JSON.stringify(step.action.args)})
                                  </span>
                                </div>
                                {step.error ? (
                                  <div className="flex gap-1.5 text-red-600">
                                    <span className="font-bold select-none">Error:</span>
                                    <span>{step.error}</span>
                                  </div>
                                ) : (
                                  <div className="flex gap-1.5 text-teal-600">
                                    <span className="font-bold select-none">Observation:</span>
                                    <span className="break-all text-slate-800">{step.observation}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex flex-col items-start space-y-2" id="chat-loading">
            <div className="text-[9px] text-slate-400">ИИ-Агент думает...</div>
            <div className="flex items-center gap-2 bg-slate-100 text-slate-600 px-4 py-3 rounded-2xl rounded-tl-sm border border-slate-200 shadow-sm">
              <RefreshCw className="animate-spin text-indigo-500 shrink-0" size={14} />
              <span className="text-xs">Выполняю цепочку Thought ➔ Action ➔ Observation...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="relative mt-auto" id="input-form">
        <input
          type="text"
          disabled={isLoading}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Спросите агента на русском языке..."
          className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-indigo-500 rounded-xl pl-4 pr-11 py-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none transition-all disabled:opacity-50"
          id="chat-input"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="absolute right-2 top-2 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all disabled:opacity-40 disabled:bg-slate-200 cursor-pointer"
          id="btn-send"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
