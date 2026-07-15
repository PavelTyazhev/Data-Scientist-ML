import { useState } from 'react';
import { UnitTestResult, Subscription } from '../types';
import {
  Play,
  Terminal,
  Database,
  CheckCircle,
  XCircle,
  Code,
  FileJson,
  Check,
  Zap,
  Activity
} from 'lucide-react';

interface TestConsoleProps {
  onRunTests: () => Promise<UnitTestResult[]>;
  subscriptions: Subscription[];
}

export default function TestConsole({ onRunTests, subscriptions }: TestConsoleProps) {
  const [testResults, setTestResults] = useState<UnitTestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'tests' | 'database' | 'checklist'>('tests');

  const handleRunTests = async () => {
    setIsRunning(true);
    try {
      const results = await onRunTests();
      setTestResults(results);
    } catch (err) {
      console.error('Failed to run backend tests', err);
    } finally {
      setIsRunning(false);
    }
  };

  const checklistItems = [
    {
      title: 'Сценарий ReAct рассуждений',
      desc: 'Агент разделяет вопросы на шаги, вызывает инструменты и логирует Thought / Action / Observation.',
      status: true,
    },
    {
      title: 'Инструмент 1: get_obligations',
      desc: 'Возвращает список финансовых обязательств пользователя с поддержкой фильтров status и category.',
      status: true,
    },
    {
      title: 'Инструмент 2: convert_currency',
      desc: 'Конвертирует суммы через API frankfurter.app с автоматическим fallback-режимом для RUB и оффлайна.',
      status: true,
    },
    {
      title: 'Unit-тесты (минимум 3)',
      desc: 'Реализованы автоматические тесты для get_obligations, convert_currency и логики фильтрации (всего 5 проверок).',
      status: true,
    },
    {
      title: 'Модель ИИ: Sberbank GigaChat',
      desc: 'Обеспечивает быстрое логическое рассуждение и формирование точных структурированных ответов на русском языке.',
      status: true,
    },
    {
      title: 'Защита от галлюцинаций',
      desc: 'Агент честно сообщает о невозможности получить данные или сбоях API, вместо выдумывания курсов.',
      status: true,
    }
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4" id="developer-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4" id="panel-header">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
            <Terminal size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 font-display">Панель разработчика (ML-инженер)</h2>
            <p className="text-[10px] text-slate-500">Инструменты тестирования, контроля и верификации бизнес-логики ИИ</p>
          </div>
        </div>

        {/* Console Nav Tabs */}
        <div className="flex bg-slate-100/80 p-1 rounded-lg border border-slate-200/60" id="console-tabs">
          <button
            onClick={() => setActiveTab('tests')}
            className={`flex items-center gap-1 px-3 py-1 text-[10px] font-semibold rounded-md transition-all cursor-pointer ${
              activeTab === 'tests' ? 'bg-white text-indigo-600 border border-slate-200/60 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Code size={12} />
            <span>Unit-тесты</span>
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`flex items-center gap-1 px-3 py-1 text-[10px] font-semibold rounded-md transition-all cursor-pointer ${
              activeTab === 'database' ? 'bg-white text-indigo-600 border border-slate-200/60 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database size={12} />
            <span>База данных</span>
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`flex items-center gap-1 px-3 py-1 text-[10px] font-semibold rounded-md transition-all cursor-pointer ${
              activeTab === 'checklist' ? 'bg-white text-indigo-600 border border-slate-200/60 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Zap size={12} />
            <span>Чек-лист</span>
          </button>
        </div>
      </div>

      {/* Tab Contents: Tests */}
      {activeTab === 'tests' && (
        <div className="space-y-4" id="tests-tab-content">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200/60" id="tests-controls">
            <div>
              <h3 className="text-xs font-semibold text-slate-800">Тестирование инструментов агента</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Запустите набор тестов на сервере для валидации get_obligations() и convert_currency().
              </p>
            </div>
            <button
              onClick={handleRunTests}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg transition-all shadow-sm shadow-indigo-100 cursor-pointer disabled:opacity-50"
              id="btn-run-tests"
            >
              {isRunning ? (
                <>
                  <Activity className="animate-spin" size={14} />
                  <span>Выполнение...</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Запустить unit-тесты</span>
                </>
              )}
            </button>
          </div>

          {/* Test Outcomes Display */}
          {testResults.length === 0 ? (
            <div className="py-8 text-center bg-slate-50/50 border border-dashed border-slate-200 rounded-xl" id="tests-not-run">
              <Code className="mx-auto text-slate-400 mb-2" size={24} />
              <p className="text-xs text-slate-500">Тесты еще не запускались в этой сессии</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Нажмите синюю кнопку выше для запуска полного пакета проверок.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1" id="tests-results-list">
              {testResults.map((result, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border flex flex-col gap-1 text-[10px] transition-all ${
                    result.passed
                      ? 'bg-emerald-50/50 border-emerald-200/60'
                      : 'bg-red-50/50 border-red-200/60'
                  }`}
                  id={`test-card-${idx}`}
                >
                  <div className="flex items-start justify-between">
                    <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                      {result.passed ? (
                        <CheckCircle className="text-emerald-600 shrink-0" size={14} />
                      ) : (
                        <XCircle className="text-red-600 shrink-0" size={14} />
                      )}
                      {result.name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                        result.passed
                          ? 'bg-emerald-55 text-emerald-700 border border-emerald-200'
                          : 'bg-red-55 text-red-700 border border-red-200'
                      }`}
                    >
                      {result.passed ? 'Успешно' : 'Сбой'}
                    </span>
                  </div>

                  {result.message && <p className="text-slate-600 mt-1">{result.message}</p>}
                  {result.error && <p className="text-red-600 mt-1 font-semibold">Error: {result.error}</p>}

                  {(result.expected || result.actual) && (
                    <div className="grid grid-cols-2 gap-2 mt-1.5 bg-slate-50 p-2 rounded border border-slate-200/60 text-[9px] font-mono">
                      <div>
                        <span className="text-slate-400">Ожидалось:</span>
                        <div className="text-slate-700 mt-0.5">{JSON.stringify(result.expected)}</div>
                      </div>
                      <div>
                        <span className="text-slate-400">Получено:</span>
                        <div className="text-slate-700 mt-0.5">{JSON.stringify(result.actual)}</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Contents: Database */}
      {activeTab === 'database' && (
        <div className="space-y-3" id="db-tab-content">
          <div className="flex items-center justify-between" id="db-info">
            <div>
              <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <FileJson size={14} className="text-indigo-600" />
                subscriptions.json database
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Локальная файловая СУБД с текущими записями обязательств ({subscriptions.length} элементов)</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 max-h-72 overflow-y-auto" id="db-json-container">
            <pre className="text-[9px] font-mono text-slate-600 leading-normal whitespace-pre">
              {JSON.stringify(subscriptions, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Tab Contents: Checklist */}
      {activeTab === 'checklist' && (
        <div className="space-y-2 pr-1 max-h-80 overflow-y-auto" id="checklist-tab-content">
          <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
            Ниже приведены требования бизнес-кейса и ИИ-архитектуры из технического задания, которые полностью покрыты в данном решении:
          </p>
          {checklistItems.map((item, idx) => (
            <div key={idx} className="flex gap-2.5 p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl" id={`checklist-item-${idx}`}>
              <div className="mt-0.5 bg-emerald-50 text-emerald-600 p-1 rounded-full border border-emerald-100 shrink-0">
                <Check size={12} className="stroke-[3]" />
              </div>
              <div>
                <h4 className="text-[11px] font-semibold text-slate-800">{item.title}</h4>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-normal">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
