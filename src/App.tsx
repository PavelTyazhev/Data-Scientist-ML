import { useState, useEffect } from 'react';
import { Subscription, ChatMessage, UnitTestResult } from './types';
import Dashboard from './components/Dashboard';
import ChatInterface from './components/ChatInterface';
import TestConsole from './components/TestConsole';
import {
  Sparkles,
  ShieldCheck,
  CreditCard,
  Clock,
  ExternalLink
} from 'lucide-react';

export default function App() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load subscriptions on startup
  const fetchSubscriptions = async () => {
    try {
      const res = await fetch('/api/subscriptions');
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data);
        setErrorMessage(null);
      } else {
        setErrorMessage('Не удалось загрузить реестр подписок.');
      }
    } catch (err) {
      console.error('Error fetching subscriptions:', err);
      setErrorMessage('Ошибка подключения к серверу.');
    }
  };

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  // CRUD API helpers passed to child components
  const handleAddSubscription = async (newSub: Omit<Subscription, 'id'>) => {
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSub),
      });
      if (res.ok) {
        await fetchSubscriptions();
      } else {
        const errData = await res.json();
        alert(`Ошибка добавления подписки: ${errData.error || 'Неизвестная ошибка'}`);
      }
    } catch (err) {
      console.error('Add subscription error:', err);
    }
  };

  const handleEditSubscription = async (id: string, updatedFields: Partial<Subscription>) => {
    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields),
      });
      if (res.ok) {
        await fetchSubscriptions();
      } else {
        const errData = await res.json();
        alert(`Ошибка обновления подписки: ${errData.error || 'Неизвестная ошибка'}`);
      }
    } catch (err) {
      console.error('Edit subscription error:', err);
    }
  };

  const handleDeleteSubscription = async (id: string) => {
    if (!confirm('Вы действительно хотите удалить эту подписку?')) return;
    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchSubscriptions();
      } else {
        alert('Не удалось удалить подписку.');
      }
    } catch (err) {
      console.error('Delete subscription error:', err);
    }
  };

  // Chat message sending pipeline
  const handleSendMessage = async (queryText: string): Promise<ChatMessage> => {
    setIsAgentLoading(true);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: queryText,
      timestamp: new Date().toISOString(),
    };

    setChatHistory((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText }),
      });

      const data = await res.json();

      if (res.ok) {
        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          sender: 'agent',
          text: data.answer,
          timestamp: new Date().toISOString(),
          steps: data.steps || [],
        };

        setChatHistory((prev) => [...prev, agentMsg]);
        // Auto refresh subscriptions in case the agent had any side-effects or user wants to see updated lists
        await fetchSubscriptions();
        setIsAgentLoading(false);
        return agentMsg;
      } else {
        // Handle gracefully if API Key is missing or other backend errors
        const errMsgText = data.message || data.error || 'Произошла ошибка при обращении к ИИ.';
        const systemMsg: ChatMessage = {
          id: `sys-${Date.now()}`,
          sender: 'system',
          text: `⚠️ Ошибка: ${errMsgText}`,
          timestamp: new Date().toISOString(),
        };

        setChatHistory((prev) => [...prev, systemMsg]);
        setIsAgentLoading(false);
        return systemMsg;
      }
    } catch (err: any) {
      console.error('Agent communication failed:', err);
      const errSystemMsg: ChatMessage = {
        id: `sys-err-${Date.now()}`,
        sender: 'system',
        text: '❌ Ошибка подключения: Не удалось связаться с сервером AI-агента. Проверьте запуск backend.',
        timestamp: new Date().toISOString(),
      };
      setChatHistory((prev) => [...prev, errSystemMsg]);
      setIsAgentLoading(false);
      return errSystemMsg;
    }
  };

  const handleClearHistory = () => {
    setChatHistory([]);
  };

  const handleRunTestsOnBackend = async (): Promise<UnitTestResult[]> => {
    const res = await fetch('/api/tests/run', { method: 'POST' });
    if (!res.ok) {
      throw new Error('Backend test run failed');
    }
    return res.json();
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans selection:bg-indigo-500/10" id="app-root">
      {/* Premium Fintech Navigation Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40 px-6 py-3 shadow-sm" id="app-header">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-emerald-500 to-indigo-600 p-2.5 rounded-xl text-white shadow-md shadow-indigo-100">
              <CreditCard size={20} className="animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-900 font-display flex items-center gap-2">
                Умный реестр подписок
                <span className="text-[10px] bg-emerald-50 text-emerald-600 font-mono px-1.5 py-0.5 rounded border border-emerald-100 flex items-center gap-1 font-semibold">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                  Active
                </span>
              </h1>
              <p className="text-[10px] text-slate-500">Управляющая AI-платформа личных подписок и списаний</p>
            </div>
          </div>

          {/* User profile / Time info bar */}
          <div className="flex items-center gap-4 text-[10px] text-slate-500" id="info-bar">
            <div className="flex items-center gap-1.5 bg-slate-100/80 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
              <Clock size={12} className="text-slate-400" />
              <span>Эмулируемая дата: <strong className="text-indigo-600">2026-07-15</strong></span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6" id="app-main-content">
        {errorMessage && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3 text-xs text-red-600" id="error-banner">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="app-bento-grid">
          {/* Left Column: Subscriptions Database & Stats */}
          <div className="lg:col-span-7 space-y-6" id="left-column">
            <Dashboard
              subscriptions={subscriptions}
              onRefresh={fetchSubscriptions}
              onAdd={handleAddSubscription}
              onEdit={handleEditSubscription}
              onDelete={handleDeleteSubscription}
            />
            {/* Developer Test Console directly below database */}
            <TestConsole onRunTests={handleRunTestsOnBackend} subscriptions={subscriptions} />
          </div>

          {/* Right Column: AI Reasoning ReAct Chat Agent */}
          <div className="lg:col-span-5" id="right-column">
            <ChatInterface
              onSendMessage={handleSendMessage}
              chatHistory={chatHistory}
              isLoading={isAgentLoading}
              onClearHistory={handleClearHistory}
            />
          </div>
        </div>
      </main>

      {/* Subtle footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-center text-[10px] text-slate-400 flex items-center justify-center gap-2 mt-auto" id="app-footer">
        <span>Smart Registry of Subscriptions © 2026</span>
        <span>•</span>
        <span className="flex items-center gap-0.5 text-slate-500">
          <ShieldCheck size={10} className="text-emerald-500" />
          Full-Stack ReAct AI Sandbox Powered by GigaChat
        </span>
      </footer>
    </div>
  );
}
